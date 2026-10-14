import { BufferAttribute, BufferGeometry, Group, Mesh, type Scene } from 'three';
import { CHUNK_SIZE } from '../config.ts';
import type { Chunk } from '../world/Chunk.ts';
import { chunkKey } from '../world/Chunk.ts';
import type { World } from '../world/World.ts';
import type { ChunkMaterials } from './ChunkMaterial.ts';
import { ChunkMesher, type MeshData } from './ChunkMesher.ts';

interface ChunkMeshes {
  group: Group;
  meshes: Mesh[];
}

/**
 * Управляет мешами чанков в сцене: строит «грязные» чанки с бюджетом времени
 * (ближайшие — первыми), удаляет меши выгруженных и далёких чанков.
 */
export class ChunkRenderer {
  private scene: Scene;
  private world: World;
  private materials: ChunkMaterials;
  private mesher = new ChunkMesher();
  private meshes = new Map<string, ChunkMeshes>();
  /** Счётчики для отладочной панели. */
  stats = { meshed: 0, triangles: 0, pending: 0 };

  constructor(scene: Scene, world: World, materials: ChunkMaterials) {
    this.scene = scene;
    this.world = world;
    this.materials = materials;
    world.onChunkUnloaded = (chunk) => this.removeChunk(chunk);
  }

  /** Сколько чанков попадает в круг прорисовки заданного радиуса (для прогресса загрузки). */
  static chunksInRadius(renderDistance: number): number {
    const r2 = ChunkRenderer.radiusSq(renderDistance);
    let n = 0;
    for (let dz = -renderDistance; dz <= renderDistance; dz++) {
      for (let dx = -renderDistance; dx <= renderDistance; dx++) {
        if (dx * dx + dz * dz <= r2) n++;
      }
    }
    return n;
  }

  private static radiusSq(renderDistance: number): number {
    return (renderDistance + 0.5) * (renderDistance + 0.5);
  }

  /** Перестраивает грязные чанки в радиусе; возвращает число чанков, ещё ожидающих построения. */
  update(px: number, pz: number, renderDistance: number, budgetMs: number): number {
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    const r2 = ChunkRenderer.radiusSq(renderDistance);
    const queue: { chunk: Chunk; d: number }[] = [];

    for (const chunk of this.world.chunks.values()) {
      const dx = chunk.cx - pcx;
      const dz = chunk.cz - pcz;
      const d = dx * dx + dz * dz;
      const key = chunkKey(chunk.cx, chunk.cz);
      if (d > r2) {
        // Вышел за дальность прорисовки — меш не нужен.
        if (this.meshes.has(key)) {
          this.removeChunk(chunk);
          chunk.dirty = true;
        }
        continue;
      }
      if (chunk.dirty && this.world.hasAllNeighbors(chunk.cx, chunk.cz)) {
        queue.push({ chunk, d });
      }
    }

    if (queue.length === 0) {
      this.stats.pending = 0;
      return 0;
    }
    queue.sort((a, b) => a.d - b.d);
    const start = performance.now();
    let built = 0;
    for (const item of queue) {
      this.buildChunk(item.chunk);
      built++;
      if (performance.now() - start > budgetMs) break;
    }
    this.stats.pending = queue.length - built;
    return this.stats.pending;
  }

  private buildChunk(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    this.removeByKey(key);
    const result = this.mesher.mesh(chunk, (dx, dz) => this.world.getChunk(chunk.cx + dx, chunk.cz + dz)?.blocks ?? null);
    chunk.dirty = false;

    const group = new Group();
    group.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    group.matrixAutoUpdate = false;
    group.updateMatrix();
    const meshes: Mesh[] = [];

    const add = (data: MeshData | null, material: ChunkMaterials['opaque'], renderOrder: number) => {
      if (!data) return;
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(data.positions, 3));
      geometry.setAttribute('uv', new BufferAttribute(data.uvs, 2));
      geometry.setAttribute('layer', new BufferAttribute(data.layers, 1));
      geometry.setAttribute('light', new BufferAttribute(data.lights, 1));
      geometry.setIndex(new BufferAttribute(data.indices, 1));
      geometry.computeBoundingSphere();
      const mesh = new Mesh(geometry, material);
      mesh.renderOrder = renderOrder;
      mesh.matrixAutoUpdate = false;
      group.add(mesh);
      meshes.push(mesh);
      this.stats.triangles += data.indices.length / 3;
    };
    add(result.opaque, this.materials.opaque, 0);
    add(result.cutout, this.materials.cutout, 1);
    add(result.water, this.materials.water, 2);

    if (meshes.length > 0) {
      this.scene.add(group);
      this.meshes.set(key, { group, meshes });
      this.stats.meshed++;
    }
  }

  removeChunk(chunk: Chunk): void {
    this.removeByKey(chunkKey(chunk.cx, chunk.cz));
  }

  private removeByKey(key: string): void {
    const entry = this.meshes.get(key);
    if (!entry) return;
    for (const mesh of entry.meshes) {
      const idx = mesh.geometry.getIndex();
      if (idx) this.stats.triangles -= idx.count / 3;
      mesh.geometry.dispose();
    }
    this.scene.remove(entry.group);
    this.meshes.delete(key);
    this.stats.meshed--;
  }

  dispose(): void {
    for (const key of [...this.meshes.keys()]) this.removeByKey(key);
  }
}
