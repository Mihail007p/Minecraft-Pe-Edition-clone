// Построение геометрии чанка: отсечение невидимых граней, вершинное AO,
// упрощённое «столбцовое» освещение от неба. Чистый TypeScript без three.js —
// на выходе типизированные массивы, которые рендер заворачивает в BufferGeometry.

import { CHUNK_HEIGHT, CHUNK_SIZE } from '../config.ts';
import { AIR, BLOCKS, BLOCK_OPAQUE, isWater, liquidSurfaceHeight, type BlockDef } from '../world/Blocks.ts';
import type { Chunk } from '../world/Chunk.ts';
import { BLOCK_FACE_LAYER, fillFaceLayers } from './faceLayers.ts';

export interface MeshData {
  positions: Float32Array;
  uvs: Float32Array;
  layers: Float32Array;
  lights: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
}

export interface ChunkMeshResult {
  opaque: MeshData | null;
  cutout: MeshData | null;
  water: MeshData | null;
}

/** Описание грани: нормаль, базовая вершина и касательные u, v (u × v = n). */
interface FaceDef {
  n: readonly [number, number, number];
  base: readonly [number, number, number];
  u: readonly [number, number, number];
  v: readonly [number, number, number];
  shade: number;
}

const FACES: readonly FaceDef[] = [
  { n: [1, 0, 0], base: [1, 0, 1], u: [0, 0, -1], v: [0, 1, 0], shade: 0.68 }, // +X
  { n: [-1, 0, 0], base: [0, 0, 0], u: [0, 0, 1], v: [0, 1, 0], shade: 0.68 }, // -X
  { n: [0, 1, 0], base: [0, 1, 1], u: [1, 0, 0], v: [0, 0, -1], shade: 1.0 }, // +Y
  { n: [0, -1, 0], base: [0, 0, 0], u: [1, 0, 0], v: [0, 0, 1], shade: 0.52 }, // -Y
  { n: [0, 0, 1], base: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], shade: 0.82 }, // +Z
  { n: [0, 0, -1], base: [1, 0, 0], u: [-1, 0, 0], v: [0, 1, 0], shade: 0.82 }, // -Z
];

/** Смещения углов квада в терминах (u, v): p0 = base, p1 = base+u, p2 = base+u+v, p3 = base+v. */
const CORNERS: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
/** Направления к углу для выборки AO: (знак u, знак v). */
const CORNER_DIRS: readonly (readonly [number, number])[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const AO_CURVE = [0.45, 0.65, 0.84, 1.0];

const LIGHT_FALLOFF = 0.085; // затухание света на блок глубины под поверхностью
const LIGHT_MIN = 0.22;

/** Растущий буфер вершин для одного прохода рендера. */
class MeshBuilder {
  positions: number[] = [];
  uvs: number[] = [];
  layers: number[] = [];
  lights: number[] = [];
  indices: number[] = [];
  vertexCount = 0;

  /** Добавить квад из 4 вершин (CCW снаружи). light — освещённость каждой вершины. */
  quad(
    px: readonly number[], py: readonly number[], pz: readonly number[],
    layer: number, light: readonly number[], flip: boolean,
  ): void {
    const base = this.vertexCount;
    for (let i = 0; i < 4; i++) {
      this.positions.push(px[i], py[i], pz[i]);
      this.layers.push(layer);
      this.lights.push(light[i]);
    }
    // p0 (0,1) p1 (1,1) p2 (1,0) p3 (0,0): v=0 — верх текстуры (данные без flipY)
    this.uvs.push(0, 1, 1, 1, 1, 0, 0, 0);
    if (flip) this.indices.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.vertexCount += 4;
  }

  build(): MeshData | null {
    if (this.vertexCount === 0) return null;
    return {
      positions: new Float32Array(this.positions),
      uvs: new Float32Array(this.uvs),
      layers: new Float32Array(this.layers),
      lights: new Float32Array(this.lights),
      indices: new Uint32Array(this.indices),
      vertexCount: this.vertexCount,
    };
  }
}

const S = CHUNK_SIZE;
const H = CHUNK_HEIGHT;
const PAD = S + 2; // 18 столбцов с запасом по 1 с каждой стороны

/**
 * Мешер держит ссылки на 3×3 чанка вокруг целевого, чтобы читать блоки за границей.
 */
export class ChunkMesher {
  private neighbors: (Uint8Array | null)[] = new Array(9).fill(null);
  private heightMap = new Int16Array(PAD * PAD);
  private px = [0, 0, 0, 0];
  private py = [0, 0, 0, 0];
  private pz = [0, 0, 0, 0];
  private light = [0, 0, 0, 0];

  constructor() {
    fillFaceLayers();
  }

  /** getChunkBlocks(dx, dz) → данные соседнего чанка (dx, dz ∈ {-1, 0, 1}) или null. */
  mesh(chunk: Chunk, getChunkBlocks: (dx: number, dz: number) => Uint8Array | null): ChunkMeshResult {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        this.neighbors[dx + 1 + (dz + 1) * 3] = dx === 0 && dz === 0 ? chunk.blocks : getChunkBlocks(dx, dz);
      }
    }
    this.buildHeightMap();

    const opaque = new MeshBuilder();
    const cutout = new MeshBuilder();
    const water = new MeshBuilder();
    const blocks = chunk.blocks;

    for (let y = 0; y < H; y++) {
      for (let z = 0; z < S; z++) {
        for (let x = 0; x < S; x++) {
          const id = blocks[x + (z << 4) + (y << 8)];
          if (id === AIR) continue;
          const def = BLOCKS[id];
          if (def.shape === 'cross') {
            this.addCross(cutout, x, y, z, def);
            continue;
          }
          const builder = def.renderPass === 'water' ? water : def.renderPass === 'cutout' ? cutout : opaque;
          this.addCube(builder, x, y, z, id, def);
        }
      }
    }

    return { opaque: opaque.build(), cutout: cutout.build(), water: water.build() };
  }

  /** Блок по локальным координатам чанка с выходом за границу на 1 блок. */
  private get(x: number, y: number, z: number): number {
    if (y < 0 || y >= H) return AIR;
    const cx = x < 0 ? 0 : x >= S ? 2 : 1;
    const cz = z < 0 ? 0 : z >= S ? 2 : 1;
    const data = this.neighbors[cx + cz * 3];
    if (!data) return AIR;
    return data[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  private buildHeightMap(): void {
    for (let z = -1; z <= S; z++) {
      for (let x = -1; x <= S; x++) {
        const cx = x < 0 ? 0 : x >= S ? 2 : 1;
        const cz = z < 0 ? 0 : z >= S ? 2 : 1;
        const data = this.neighbors[cx + cz * 3];
        let top = 0;
        if (data) {
          const col = (x & 15) + ((z & 15) << 4);
          for (let y = H - 1; y >= 0; y--) {
            if (BLOCK_OPAQUE[data[col + (y << 8)]] === 1) { top = y + 1; break; }
          }
        }
        this.heightMap[x + 1 + (z + 1) * PAD] = top;
      }
    }
  }

  /** Освещённость «воздушного» блока: 1 над поверхностью, затухает с глубиной. */
  private columnLight(x: number, y: number, z: number): number {
    if (x < -1 || x > S || z < -1 || z > S) return 1;
    const top = this.heightMap[x + 1 + (z + 1) * PAD];
    const depth = top - y;
    if (depth <= 0) return 1;
    const l = 1 - depth * LIGHT_FALLOFF;
    return l < LIGHT_MIN ? LIGHT_MIN : l;
  }

  private isOpaque(x: number, y: number, z: number): boolean {
    return BLOCK_OPAQUE[this.get(x, y, z)] === 1;
  }

  private addCube(builder: MeshBuilder, x: number, y: number, z: number, id: number, def: BlockDef): void {
    const isLiquid = def.shape === 'liquid';
    // Погружённая вода (над ней ещё вода) занимает весь блок, иначе — уровень поверхности.
    const aboveIsWater = isLiquid && isWater(this.get(x, y + 1, z));
    const topY = isLiquid ? (aboveIsWater ? 1 : liquidSurfaceHeight(id)) : 1;

    for (let f = 0; f < 6; f++) {
      const face = FACES[f];
      const nx = x + face.n[0];
      const ny = y + face.n[1];
      const nz = z + face.n[2];
      const nId = this.get(nx, ny, nz);
      // Непрозрачный сосед полностью закрывает грань; одинаковые соседи (вода, стекло) не рисуют стык.
      // Между двумя блоками листвы оставляем ровно одну двустороннюю грань на стык (без дублей и z-fighting).
      if (BLOCK_OPAQUE[nId] === 1) continue;
      if (def.cullSame && (nId === id || (isLiquid && isWater(nId)))) continue;
      if (nId === id && (f & 1) === 1) continue;

      const faceShade = nId === id ? 0.76 : face.shade;
      const layer = BLOCK_FACE_LAYER[id * 6 + f];
      const bx = x + face.base[0];
      const by = y + face.base[1];
      const bz = z + face.base[2];

      for (let c = 0; c < 4; c++) {
        const cu = CORNERS[c][0];
        const cv = CORNERS[c][1];
        const vy = by + face.u[1] * cu + face.v[1] * cv;
        this.px[c] = bx + face.u[0] * cu + face.v[0] * cv;
        this.py[c] = topY !== 1 && vy === y + 1 ? y + topY : vy;
        this.pz[c] = bz + face.u[2] * cu + face.v[2] * cv;

        // AO и свет: выборка трёх соседей вокруг угла в плоскости грани со стороны нормали.
        const du = CORNER_DIRS[c][0];
        const dv = CORNER_DIRS[c][1];
        const s1x = nx + face.u[0] * du, s1y = ny + face.u[1] * du, s1z = nz + face.u[2] * du;
        const s2x = nx + face.v[0] * dv, s2y = ny + face.v[1] * dv, s2z = nz + face.v[2] * dv;
        const cx = s1x + face.v[0] * dv, cy = s1y + face.v[1] * dv, cz = s1z + face.v[2] * dv;
        const o1 = this.isOpaque(s1x, s1y, s1z);
        const o2 = this.isOpaque(s2x, s2y, s2z);
        const oc = this.isOpaque(cx, cy, cz);
        let ao: number;
        if (o1 && o2) ao = 0;
        else ao = 3 - ((o1 ? 1 : 0) + (o2 ? 1 : 0) + (oc ? 1 : 0));

        // Сглаженный свет: среднее по неперекрытым соседям
        let sum = this.columnLight(nx, ny, nz);
        let count = 1;
        if (!o1) { sum += this.columnLight(s1x, s1y, s1z); count++; }
        if (!o2) { sum += this.columnLight(s2x, s2y, s2z); count++; }
        if (!oc) { sum += this.columnLight(cx, cy, cz); count++; }
        const sky = sum / count;

        this.light[c] = faceShade * AO_CURVE[ao] * sky;
      }
      const flip = this.light[0] + this.light[2] < this.light[1] + this.light[3];
      builder.quad(this.px, this.py, this.pz, layer, this.light, flip);
    }
  }

  /** Крестообразные растения: два диагональных квада (материал двусторонний). */
  private addCross(builder: MeshBuilder, x: number, y: number, z: number, def: BlockDef): void {
    const layer = BLOCK_FACE_LAYER[def.id * 6 + 2];
    const l = this.columnLight(x, y, z);
    const light = [l, l, l, l];
    const i = 0.07; // небольшой отступ от краёв, чтобы растения не слипались с соседями
    // Квад A: диагональ (0,0) → (1,1)
    builder.quad(
      [x + i, x + 1 - i, x + 1 - i, x + i],
      [y, y, y + 1, y + 1],
      [z + i, z + 1 - i, z + 1 - i, z + i],
      layer, light, false,
    );
    // Квад B: диагональ (1,0) → (0,1)
    builder.quad(
      [x + 1 - i, x + i, x + i, x + 1 - i],
      [y, y, y + 1, y + 1],
      [z + i, z + 1 - i, z + 1 - i, z + i],
      layer, light, false,
    );
  }
}
