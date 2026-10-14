import { CHUNK_HEIGHT, CHUNK_SIZE, SEA_LEVEL } from '../config.ts';
import { AIR, BLOCK_SOLID, WATER } from './Blocks.ts';
import { Chunk, chunkKey } from './Chunk.ts';
import { WorldGen } from './WorldGen.ts';

export interface BlockChange {
  x: number;
  y: number;
  z: number;
  prev: number;
  next: number;
}

/**
 * Мир: хранилище чанков, доступ к блокам в мировых координатах,
 * очередь генерации вокруг игрока и выгрузка далёких чанков.
 * Рендер не знает о генерации — он лишь спрашивает, какие чанки «грязные».
 */
export class World {
  readonly gen: WorldGen;
  readonly chunks = new Map<string, Chunk>();
  /** Вызывается при выгрузке чанка (чтобы рендер удалил меш). */
  onChunkUnloaded: ((chunk: Chunk) => void) | null = null;
  /** Вызывается после изменения блока игроком. */
  onBlockChanged: ((change: BlockChange) => void) | null = null;

  private pending: { cx: number; cz: number; d: number }[] = [];
  private pendingCenter: { cx: number; cz: number; radius: number } | null = null;

  constructor(seed: number) {
    this.gen = new WorldGen(seed);
  }

  get seed(): number {
    return this.gen.seed;
  }

  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /** Возвращает чанк, при необходимости генерируя его синхронно. */
  ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cz);
      this.gen.generateChunk(chunk);
      this.chunks.set(key, chunk);
      this.markNeighborsDirty(cx, cz);
    }
    return chunk;
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return AIR;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return AIR;
    return chunk.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)];
  }

  isSolid(x: number, y: number, z: number): boolean {
    return BLOCK_SOLID[this.getBlock(x, y, z)] === 1;
  }

  /** Для физики: незагруженные чанки считаются твёрдыми, чтобы игрок не провалился. */
  isSolidForPhysics(x: number, y: number, z: number): boolean {
    if (y >= CHUNK_HEIGHT) return false;
    if (y < 0) return true;
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return true;
    return BLOCK_SOLID[chunk.blocks[(x & 15) + ((z & 15) << 4) + (y << 8)]] === 1;
  }

  isChunkLoaded(x: number, z: number): boolean {
    return this.chunks.has(chunkKey(x >> 4, z >> 4));
  }

  /** Установка блока игроком. Возвращает false, если чанк не загружен. */
  setBlock(x: number, y: number, z: number, id: number): boolean {
    if (y < 0 || y >= CHUNK_HEIGHT) return false;
    const cx = x >> 4;
    const cz = z >> 4;
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return false;
    const lx = x & 15;
    const lz = z & 15;
    const idx = lx + (lz << 4) + (y << 8);
    const prev = chunk.blocks[idx];
    if (prev === id) return true;
    chunk.blocks[idx] = id;
    chunk.modified = true;
    chunk.dirty = true;
    // Соседние чанки нужно перестроить, если блок на границе (отсечение граней, AO).
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
    if (lx === 0 && lz === 0) this.markDirty(cx - 1, cz - 1);
    if (lx === 0 && lz === CHUNK_SIZE - 1) this.markDirty(cx - 1, cz + 1);
    if (lx === CHUNK_SIZE - 1 && lz === 0) this.markDirty(cx + 1, cz - 1);
    if (lx === CHUNK_SIZE - 1 && lz === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz + 1);
    this.onBlockChanged?.({ x, y, z, prev, next: id });
    return true;
  }

  markDirty(cx: number, cz: number): void {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) c.dirty = true;
  }

  private markNeighborsDirty(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        this.markDirty(cx + dx, cz + dz);
      }
    }
  }

  /** Все ли 8 соседей чанка сгенерированы (нужно для корректного меша на границах). */
  hasAllNeighbors(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dz === 0) continue;
        if (!this.chunks.has(chunkKey(cx + dx, cz + dz))) return false;
      }
    }
    return true;
  }

  /**
   * Пошаговая генерация чанков вокруг точки с ограничением по времени.
   * Возвращает число оставшихся в очереди чанков.
   */
  update(px: number, pz: number, renderDistance: number, budgetMs: number): number {
    const cx = Math.floor(px) >> 4;
    const cz = Math.floor(pz) >> 4;
    const radius = renderDistance + 1;
    const pc = this.pendingCenter;
    if (!pc || pc.cx !== cx || pc.cz !== cz || pc.radius !== radius) {
      this.rebuildQueue(cx, cz, radius);
      this.unloadFar(cx, cz, radius + 2);
    }
    const start = performance.now();
    while (this.pending.length > 0) {
      const next = this.pending[this.pending.length - 1];
      if (!this.chunks.has(chunkKey(next.cx, next.cz))) {
        this.ensureChunk(next.cx, next.cz);
      }
      this.pending.pop();
      if (performance.now() - start > budgetMs) break;
    }
    return this.pending.length;
  }

  /** Сколько чанков ещё предстоит сгенерировать (для экрана загрузки). */
  get pendingCount(): number {
    return this.pending.length;
  }

  private rebuildQueue(cx: number, cz: number, radius: number): void {
    this.pendingCenter = { cx, cz, radius };
    const list: { cx: number; cz: number; d: number }[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const x = cx + dx;
        const z = cz + dz;
        if (this.chunks.has(chunkKey(x, z))) continue;
        list.push({ cx: x, cz: z, d: dx * dx + dz * dz });
      }
    }
    // Ближайшие — в конец массива, чтобы снимать их через pop().
    list.sort((a, b) => b.d - a.d);
    this.pending = list;
  }

  private unloadFar(cx: number, cz: number, keepRadius: number): void {
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - cx;
      const dz = chunk.cz - cz;
      if (Math.abs(dx) > keepRadius || Math.abs(dz) > keepRadius) {
        // Изменённые чанки пока держим в памяти — они понадобятся для сохранения.
        if (!chunk.modified) {
          this.chunks.delete(key);
          this.onChunkUnloaded?.(chunk);
        } else {
          this.onChunkUnloaded?.(chunk);
          chunk.dirty = true;
        }
      }
    }
  }

  /**
   * Ищет безопасную точку спавна по реальным блокам загруженных чанков рядом с (x, z):
   * твёрдая суша выше уровня моря, два блока воздуха над ней и без ямы/обрыва вокруг.
   */
  findSafeSpawn(x: number, z: number, radius: number): { x: number; y: number; z: number } | null {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const candidates: { dx: number; dz: number }[] = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) candidates.push({ dx, dz });
    }
    candidates.sort((a, b) => a.dx * a.dx + a.dz * a.dz - (b.dx * b.dx + b.dz * b.dz));
    for (const { dx, dz } of candidates) {
      const bx = cx + dx;
      const bz = cz + dz;
      if (!this.isChunkLoaded(bx, bz)) continue;
      const top = this.surfaceHeight(bx, bz);
      if (top < SEA_LEVEL || top >= CHUNK_HEIGHT - 3) continue;
      const topId = this.getBlock(bx, top, bz);
      if (BLOCK_SOLID[topId] !== 1) continue;
      if (BLOCK_SOLID[this.getBlock(bx, top + 1, bz)] === 1 || BLOCK_SOLID[this.getBlock(bx, top + 2, bz)] === 1) continue;
      if (this.getBlock(bx, top + 1, bz) === WATER) continue;
      let flat = true;
      for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!this.isChunkLoaded(bx + nx, bz + nz)) { flat = false; break; }
        const nh = this.surfaceHeight(bx + nx, bz + nz);
        if (Math.abs(nh - top) > 1) { flat = false; break; }
      }
      if (!flat) continue;
      return { x: bx + 0.5, y: top + 1, z: bz + 0.5 };
    }
    return null;
  }

  /** Высота самого верхнего непустого блока в столбце (или -1), только для загруженных чанков. */
  surfaceHeight(x: number, z: number): number {
    const chunk = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!chunk) return -1;
    return chunk.topNonAir(x & 15, z & 15);
  }
}
