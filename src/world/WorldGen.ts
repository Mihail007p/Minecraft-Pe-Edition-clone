// Процедурная генерация мира: рельеф, биомы, пещеры, руда, деревья, растения.
// Генерация чанка полностью детерминирована и не зависит от соседей
// (деревья соседних чанков учитываются через повторный расчёт их позиций),
// поэтому модуль легко перенести в Web Worker.

import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL } from '../config.ts';
import {
  AIR, BEDROCK, CACTUS, COAL_ORE, DANDELION, DIRT, GRASS, GRAVEL, IRON_ORE, LEAVES, LOG, POPPY,
  SAND, SANDSTONE, SNOW, SNOW_GRASS, STONE, TALL_GRASS, WATER,
} from './Blocks.ts';
import { Chunk, blockIndex } from './Chunk.ts';
import { SimplexNoise, hash3, mulberry32 } from './Noise.ts';

export const BIOME_OCEAN = 0;
export const BIOME_PLAINS = 1;
export const BIOME_FOREST = 2;
export const BIOME_DESERT = 3;
export const BIOME_SNOWY = 4;
export const BIOME_MOUNTAINS = 5;

export const BIOME_NAMES: readonly string[] = ['Океан', 'Равнины', 'Лес', 'Пустыня', 'Тайга', 'Горы'];

const MAX_Y = CHUNK_HEIGHT - 1;

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

interface TreeSpec {
  x: number; // мировые координаты основания
  z: number;
  baseY: number; // y первого блока ствола
  trunk: number; // высота ствола
  conical: boolean; // "ель" для тайги
}

export class WorldGen {
  readonly seed: number;
  private terrain: SimplexNoise;
  private detail: SimplexNoise;
  private climate: SimplexNoise;
  private caves: SimplexNoise;
  private caves2: SimplexNoise;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.terrain = new SimplexNoise(this.seed ^ 0x1a2b3c4d);
    this.detail = new SimplexNoise(this.seed ^ 0x5e6f7081);
    this.climate = new SimplexNoise(this.seed ^ 0x92a3b4c5);
    this.caves = new SimplexNoise(this.seed ^ 0xd6e7f809);
    this.caves2 = new SimplexNoise(this.seed ^ 0x1b2c3d4e);
  }

  /** Континентальность в [-1, 1]: < 0 — океан, > 0 — суша. */
  continent(x: number, z: number): number {
    return this.terrain.fbm2D(x / 420, z / 420, 3, 2, 0.55);
  }

  /** Высота поверхности (y верхнего твёрдого блока) в мировых координатах. */
  heightAt(x: number, z: number): number {
    const c = this.continent(x, z);
    const hills = this.detail.fbm2D(x / 95 + 31.7, z / 95 - 17.3, 4, 2.1, 0.5);
    const ridge = 1 - Math.abs(this.terrain.noise2D(x / 170 - 200, z / 170 + 200));
    const land = smoothstep(-0.12, 0.25, c);
    const mountainMask = smoothstep(0.2, 0.5, c) * smoothstep(-0.1, 0.45, this.climate.noise2D(x / 300 + 900, z / 300 - 900));
    let h = SEA_LEVEL + 1 + c * 16;
    h += smoothstep(-0.03, 0.14, c) * 3; // быстрый подъём у берега — узкие пляжи
    h += hills * (3 + land * 9);
    h += ridge * ridge * mountainMask * 40;
    h += this.detail.noise2D(x / 18, z / 18) * 1.5 * land;
    return Math.max(4, Math.min(MAX_Y - 1, Math.round(h)));
  }

  temperature(x: number, z: number): number {
    return this.climate.fbm2D(x / 330 + 555, z / 330 + 555, 2, 2, 0.5);
  }

  humidity(x: number, z: number): number {
    return this.climate.fbm2D(x / 260 - 777, z / 260 + 333, 2, 2, 0.5);
  }

  biomeAt(x: number, z: number, h: number): number {
    if (h < SEA_LEVEL - 1) return BIOME_OCEAN;
    if (h >= 70) return BIOME_MOUNTAINS;
    const temp = this.temperature(x, z) - Math.max(0, h - 52) / 30;
    const humid = this.humidity(x, z);
    if (temp < -0.32) return BIOME_SNOWY;
    if (temp > 0.3 && humid < 0.05) return BIOME_DESERT;
    if (humid > 0.12) return BIOME_FOREST;
    return BIOME_PLAINS;
  }

  /** Ищем точку спавна на суше рядом с началом координат. */
  findSpawn(): { x: number; y: number; z: number } {
    for (let r = 0; r < 64; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = dx * 8;
          const z = dz * 8;
          const h = this.heightAt(x, z);
          const biome = this.biomeAt(x, z, h);
          if (h > SEA_LEVEL + 1 && h < 62 && biome !== BIOME_OCEAN) {
            return { x: x + 0.5, y: h + 1, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 0.5, y: this.heightAt(0, 0) + 1, z: 0.5 };
  }

  generateChunk(chunk: Chunk): void {
    const blocks = chunk.blocks;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const heights = new Int16Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomes = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    const seed = this.seed;

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = ox + x;
        const wz = oz + z;
        const h = this.heightAt(wx, wz);
        const biome = this.biomeAt(wx, wz, h);
        heights[x + z * CHUNK_SIZE] = h;
        biomes[x + z * CHUNK_SIZE] = biome;

        const beach = h <= SEA_LEVEL + 1 && h >= SEA_LEVEL - 5;
        let top: number;
        let filler: number;
        if (biome === BIOME_DESERT) {
          top = SAND;
          filler = SAND;
        } else if (beach) {
          top = SAND;
          filler = SAND;
        } else if (biome === BIOME_OCEAN) {
          top = hash3(wx, 0, wz, seed) < 0.35 ? GRAVEL : DIRT;
          filler = DIRT;
        } else if (biome === BIOME_SNOWY) {
          top = SNOW_GRASS;
          filler = DIRT;
        } else if (biome === BIOME_MOUNTAINS) {
          top = h >= 82 ? SNOW : STONE;
          filler = STONE;
        } else {
          top = GRASS;
          filler = DIRT;
        }

        const fillerDepth = biome === BIOME_DESERT ? 6 : 3;
        const colBase = x + (z << 4);
        for (let y = 0; y <= Math.min(h, MAX_Y); y++) {
          let id: number;
          if (y === 0 || (y === 1 && hash3(wx, y, wz, seed) < 0.5)) {
            id = BEDROCK;
          } else if (y < h - fillerDepth) {
            id = STONE;
            // Руда: небольшие "жилы" на основе хеша укрупнённой сетки.
            const vein = hash3(wx >> 1, y >> 1, wz >> 1, seed ^ 0x77);
            if (vein < 0.016 && y < 56 && hash3(wx, y, wz, seed ^ 0x99) < 0.7) id = COAL_ORE;
            else if (vein > 0.9965 && y < 34 && hash3(wx, y, wz, seed ^ 0xaa) < 0.65) id = IRON_ORE;
          } else if (y < h) {
            id = filler;
            if (biome === BIOME_DESERT && y < h - 3) id = SANDSTONE;
          } else {
            id = top;
          }
          blocks[colBase + (y << 8)] = id;
        }
        for (let y = h + 1; y <= SEA_LEVEL && y <= MAX_Y; y++) {
          blocks[colBase + (y << 8)] = WATER;
        }

        // Пещеры: пересечение двух шумовых поверхностей даёт извилистые туннели.
        const underwater = h < SEA_LEVEL + 2;
        const caveTop = underwater ? h - 6 : h;
        for (let y = 2; y <= caveTop; y++) {
          const n1 = this.caves.noise3D(wx * 0.045, y * 0.07, wz * 0.045);
          const n2 = this.caves2.noise3D(wx * 0.045 + 50, y * 0.07, wz * 0.045 - 50);
          const d = n1 * n1 + n2 * n2;
          // У поверхности туннели сужаются — меньше случайных дыр в земле, но входы в пещеры остаются.
          const surfaceFactor = Math.min(1, Math.max(0.3, (h - y + 1) / 8));
          const threshold = (y < 12 ? 0.012 : 0.02) * surfaceFactor;
          if (d < threshold) {
            const idx = colBase + (y << 8);
            if (blocks[idx] !== BEDROCK && blocks[idx] !== WATER) blocks[idx] = AIR;
          }
        }
      }
    }

    this.decorate(chunk, heights, biomes);
  }

  /** Растения, кактусы и деревья (в том числе заходящие из соседних чанков). */
  private decorate(chunk: Chunk, heights: Int16Array, biomes: Uint8Array): void {
    const blocks = chunk.blocks;
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const seed = this.seed;

    // Низкая растительность
    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const h = heights[x + z * CHUNK_SIZE];
        if (h + 1 > MAX_Y) continue;
        const biome = biomes[x + z * CHUNK_SIZE];
        const topIdx = blockIndex(x, h, z);
        const top = blocks[topIdx];
        const aboveIdx = blockIndex(x, h + 1, z);
        if (blocks[aboveIdx] !== AIR) continue;
        const r = hash3(ox + x, 7777, oz + z, seed ^ 0x51);
        if (top === GRASS) {
          const grassChance = biome === BIOME_FOREST ? 0.1 : 0.16;
          if (r < 0.012) blocks[aboveIdx] = DANDELION;
          else if (r < 0.02) blocks[aboveIdx] = POPPY;
          else if (r < 0.02 + grassChance) blocks[aboveIdx] = TALL_GRASS;
        } else if (top === SAND && biome === BIOME_DESERT && r < 0.006) {
          const height = 1 + Math.floor(hash3(ox + x, 8888, oz + z, seed) * 3);
          for (let i = 0; i < height && h + 1 + i <= MAX_Y; i++) {
            blocks[blockIndex(x, h + 1 + i, z)] = CACTUS;
          }
        }
      }
    }

    // Деревья: рассматриваем свой чанк и 8 соседей, чтобы кроны пересекали границы корректно.
    for (let dcz = -1; dcz <= 1; dcz++) {
      for (let dcx = -1; dcx <= 1; dcx++) {
        const trees = this.treesForChunk(chunk.cx + dcx, chunk.cz + dcz);
        for (const t of trees) this.placeTree(chunk, t, ox, oz);
      }
    }
  }

  private treesForChunk(cx: number, cz: number): TreeSpec[] {
    const rng = mulberry32((hash3(cx, 31, cz, this.seed ^ 0xabcdef) * 4294967295) >>> 0);
    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;
    const centerBiome = this.biomeAt(ox + 8, oz + 8, this.heightAt(ox + 8, oz + 8));
    let attempts: number;
    switch (centerBiome) {
      case BIOME_FOREST: attempts = 7 + Math.floor(rng() * 4); break;
      case BIOME_SNOWY: attempts = 3 + Math.floor(rng() * 3); break;
      case BIOME_PLAINS: attempts = rng() < 0.35 ? 1 : 0; break;
      case BIOME_MOUNTAINS: attempts = rng() < 0.3 ? 1 : 0; break;
      default: attempts = 0;
    }
    const out: TreeSpec[] = [];
    for (let i = 0; i < attempts; i++) {
      const lx = 2 + Math.floor(rng() * 12);
      const lz = 2 + Math.floor(rng() * 12);
      const wx = ox + lx;
      const wz = oz + lz;
      const h = this.heightAt(wx, wz);
      const biome = this.biomeAt(wx, wz, h);
      if (h <= SEA_LEVEL + 1 || h + 8 > MAX_Y) continue;
      if (biome === BIOME_DESERT || biome === BIOME_OCEAN) continue;
      if (biome === BIOME_MOUNTAINS && h >= 70) continue;
      const conical = biome === BIOME_SNOWY;
      const trunk = conical ? 6 + Math.floor(rng() * 3) : 4 + Math.floor(rng() * 3);
      out.push({ x: wx, z: wz, baseY: h + 1, trunk, conical });
    }
    return out;
  }

  private placeTree(chunk: Chunk, t: TreeSpec, ox: number, oz: number): void {
    const blocks = chunk.blocks;
    const put = (wx: number, wy: number, wz: number, id: number, replaceOnlyAir: boolean) => {
      const lx = wx - ox;
      const lz = wz - oz;
      if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || wy < 0 || wy > MAX_Y) return;
      const idx = blockIndex(lx, wy, lz);
      const cur = blocks[idx];
      if (replaceOnlyAir && cur !== AIR && cur !== TALL_GRASS && cur !== DANDELION && cur !== POPPY) return;
      blocks[idx] = id;
    };

    const topY = t.baseY + t.trunk - 1;
    if (t.conical) {
      // Ель: узкая коническая крона
      for (let dy = 0; dy <= t.trunk + 1; dy++) {
        const y = t.baseY + 2 + dy;
        const layer = t.trunk - 1 - dy; // 0 у макушки
        let radius: number;
        if (layer < 0) radius = 0;
        else if (layer % 2 === 0) radius = 1;
        else radius = Math.min(2, 1 + Math.floor(layer / 2));
        if (layer === t.trunk - 1) radius = 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (Math.abs(dx) === radius && Math.abs(dz) === radius && radius > 1) continue;
            if (dx === 0 && dz === 0 && y <= topY) continue;
            put(t.x + dx, y, t.z + dz, LEAVES, true);
          }
        }
      }
      put(t.x, topY + 2, t.z, LEAVES, true);
    } else {
      // Дуб: классическая крона 5×5 снизу и 3×3 сверху
      for (let dy = -2; dy <= 1; dy++) {
        const y = topY + dy;
        const radius = dy <= -1 ? 2 : 1;
        for (let dx = -radius; dx <= radius; dx++) {
          for (let dz = -radius; dz <= radius; dz++) {
            if (dx === 0 && dz === 0 && dy <= 0) continue;
            const corner = Math.abs(dx) === radius && Math.abs(dz) === radius;
            if (corner && (dy === 1 || hash3(t.x + dx, y, t.z + dz, this.seed) < 0.5)) continue;
            put(t.x + dx, y, t.z + dz, LEAVES, true);
          }
        }
      }
    }
    for (let i = 0; i < t.trunk; i++) put(t.x, t.baseY + i, t.z, LOG, false);
    // Под деревом всегда земля (чтобы ствол не висел над травой/песком)
    const lx = t.x - ox;
    const lz = t.z - oz;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE && t.baseY - 1 >= 0) {
      const idx = blockIndex(lx, t.baseY - 1, lz);
      if (blocks[idx] === GRASS || blocks[idx] === SNOW_GRASS) blocks[idx] = DIRT;
    }
  }
}
