import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGen, BIOME_NAMES, BIOME_OCEAN } from '../src/world/WorldGen.ts';
import { World } from '../src/world/World.ts';
import { Chunk } from '../src/world/Chunk.ts';
import { ChunkMesher } from '../src/render/ChunkMesher.ts';
import { raycastBlocks } from '../src/world/Raycast.ts';
import { BLOCKS, AIR, WATER, BEDROCK, GRASS, STONE } from '../src/world/Blocks.ts';
import { CHUNK_HEIGHT, SEA_LEVEL } from '../src/config.ts';

test('генерация: высоты в допустимом диапазоне, биомы разнообразны', () => {
  const gen = new WorldGen(12345);
  const hist = new Map<number, number>();
  let min = Infinity, max = -Infinity;
  for (let z = -400; z < 400; z += 7) {
    for (let x = -400; x < 400; x += 7) {
      const h = gen.heightAt(x, z);
      min = Math.min(min, h); max = Math.max(max, h);
      const b = gen.biomeAt(x, z, h);
      hist.set(b, (hist.get(b) ?? 0) + 1);
    }
  }
  assert.ok(min >= 4 && max < CHUNK_HEIGHT, `высоты ${min}..${max}`);
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  const summary = [...hist.entries()].map(([b, n]) => `${BIOME_NAMES[b]}: ${(100 * n / total).toFixed(1)}%`).join(', ');
  console.log(`  высоты ${min}..${max}; биомы — ${summary}`);
  assert.ok(hist.size >= 4, 'должно быть хотя бы 4 биома');
  assert.ok((hist.get(BIOME_OCEAN) ?? 0) / total < 0.7, 'слишком много океана');
});

test('чанк: коренная порода внизу, вода не выше уровня моря, все id валидны', () => {
  const gen = new WorldGen(777);
  for (const [cx, cz] of [[0, 0], [3, -2], [-5, 7]]) {
    const chunk = new Chunk(cx, cz);
    gen.generateChunk(chunk);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      assert.equal(chunk.get(x, 0, z), BEDROCK);
    }
    for (let i = 0; i < chunk.blocks.length; i++) {
      const id = chunk.blocks[i];
      assert.ok(id < BLOCKS.length, `неизвестный id ${id}`);
      if (id === WATER) assert.ok((i >> 8) <= SEA_LEVEL, 'вода выше уровня моря');
    }
  }
});

test('спавн на суше', () => {
  for (const seed of [1, 42, 999, 31337]) {
    const gen = new WorldGen(seed);
    const s = gen.findSpawn();
    const h = gen.heightAt(Math.floor(s.x), Math.floor(s.z));
    assert.ok(h > SEA_LEVEL, `сид ${seed}: спавн под водой (h=${h})`);
    assert.equal(s.y, h + 1);
  }
});

test('мешер: геометрия согласована и грани отсечены', () => {
  const world = new World(2024);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.ensureChunk(dx, dz);
  const chunk = world.getChunk(0, 0)!;
  const mesher = new ChunkMesher();
  const t0 = performance.now();
  const res = mesher.mesh(chunk, (dx, dz) => world.getChunk(dx, dz)?.blocks ?? null);
  const dt = performance.now() - t0;
  assert.ok(res.opaque, 'должна быть непрозрачная геометрия');
  const m = res.opaque!;
  assert.equal(m.positions.length, m.vertexCount * 3);
  assert.equal(m.uvs.length, m.vertexCount * 2);
  assert.equal(m.layers.length, m.vertexCount);
  assert.equal(m.lights.length, m.vertexCount);
  assert.equal(m.indices.length % 6, 0);
  for (const i of m.indices) assert.ok(i < m.vertexCount);
  for (const l of m.lights) assert.ok(l > 0 && l <= 1.0001, `свет вне диапазона: ${l}`);
  const faces = m.indices.length / 6;
  // Полный чанк без отсечения дал бы 16*16*96*6 граней; реально должно быть на порядки меньше
  assert.ok(faces < 20000, `слишком много граней: ${faces}`);
  console.log(`  граней: ${faces}, cutout: ${res.cutout?.indices.length ?? 0}/6, вода: ${(res.water?.indices.length ?? 0) / 6}, время ${dt.toFixed(2)} мс`);
});

test('производительность генерации и мешинга', () => {
  const world = new World(5);
  const mesher = new ChunkMesher();
  const t0 = performance.now();
  const R = 3;
  for (let dz = -R - 1; dz <= R + 1; dz++) for (let dx = -R - 1; dx <= R + 1; dx++) world.ensureChunk(dx, dz);
  const genCount = (2 * R + 3) ** 2;
  const t1 = performance.now();
  let meshCount = 0;
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    mesher.mesh(world.getChunk(dx, dz)!, (ox, oz) => world.getChunk(dx + ox, dz + oz)?.blocks ?? null);
    meshCount++;
  }
  const t2 = performance.now();
  console.log(`  генерация: ${((t1 - t0) / genCount).toFixed(2)} мс/чанк, мешинг: ${((t2 - t1) / meshCount).toFixed(2)} мс/чанк`);
  assert.ok((t1 - t0) / genCount < 40);
  assert.ok((t2 - t1) / meshCount < 40);
});

test('raycast: попадает в землю под камерой и возвращает верную нормаль', () => {
  const world = new World(99);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.ensureChunk(dx, dz);
  const h = world.surfaceHeight(8, 8);
  assert.ok(h >= 0);
  const hit = raycastBlocks(world, 8.5, h + 3, 8.5, 0, -1, 0, 10);
  assert.ok(hit, 'луч вниз должен попасть');
  assert.equal(hit!.y, h);
  assert.deepEqual([hit!.nx, hit!.ny, hit!.nz], [0, 1, 0]);
  const miss = raycastBlocks(world, 8.5, h + 3, 8.5, 0, 1, 0, 10);
  assert.equal(miss, null);
});

test('setBlock помечает соседние чанки грязными на границе', () => {
  const world = new World(1);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.ensureChunk(dx, dz);
  for (const c of world.chunks.values()) c.dirty = false;
  world.setBlock(0, 40, 5, STONE);
  assert.equal(world.getChunk(0, 0)!.dirty, true);
  assert.equal(world.getChunk(-1, 0)!.dirty, true);
  assert.equal(world.getChunk(1, 0)!.dirty, false);
  assert.equal(world.getBlock(0, 40, 5), STONE);
  world.setBlock(0, 40, 5, AIR);
  assert.equal(world.getBlock(0, 40, 5), AIR);
  assert.ok(GRASS > 0);
});
