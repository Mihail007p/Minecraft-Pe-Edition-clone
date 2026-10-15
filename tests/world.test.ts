import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorldGen, BIOME_NAMES, BIOME_OCEAN } from '../src/world/WorldGen.ts';
import { World } from '../src/world/World.ts';
import { Chunk } from '../src/world/Chunk.ts';
import { ChunkMesher } from '../src/render/ChunkMesher.ts';
import { createChunkMaterials } from '../src/render/ChunkMaterial.ts';
import { createBlockTextureArray } from '../src/render/TextureAtlas.ts';
import { getTexturePixels, TEX_SIZE } from '../src/render/textures.ts';
import { raycastBlocks } from '../src/world/Raycast.ts';
import { BLOCKS, AIR, WATER, BEDROCK, GRASS, STONE, LEAVES } from '../src/world/Blocks.ts';
import { CHUNK_HEIGHT, SEA_LEVEL } from '../src/config.ts';
import { NearestFilter } from 'three';

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

test('листва прозрачная как в жизни: сквозные просветы, полупрозрачные края, без дублей внутренних граней', () => {
  const px = getTexturePixels('leaves');
  const total = TEX_SIZE * TEX_SIZE;
  let openGaps = 0;
  let translucentLeaves = 0;
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) {
      openGaps++;
      assert.ok(px[i] > 0 && px[i + 1] > 0, 'прозрачные пиксели хранят цвет листвы без чёрного ореола');
    } else if (a < 255) {
      translucentLeaves++;
      if (px[i + 1] > px[i]) {
        assert.ok(a >= 128 && a <= 205, 'листья заметно просвечивают, но проходят alpha test 0.5');
      }
    }
  }
  const gapRatio = openGaps / total;
  assert.ok(gapRatio >= 0.65 && gapRatio <= 0.75, `сквозные просветы в листве: ${(gapRatio * 100).toFixed(1)}%`);
  assert.ok(translucentLeaves > 0, 'листья пропускают мягкий свет (полупрозрачная альфа)');

  // Атлас не размывает пиксельные просветы мипмапами на расстоянии и под углом.
  const atlas = createBlockTextureArray(4);
  assert.equal(atlas.magFilter, NearestFilter);
  assert.equal(atlas.minFilter, NearestFilter);
  assert.equal(atlas.generateMipmaps, false);

  const mats = createChunkMaterials(atlas);
  assert.equal(mats.cutout.transparent, true);
  assert.equal(mats.cutout.depthWrite, true);
  assert.equal(mats.cutout.uniforms.uAlphaTest.value, 0.5);
  mats.dispose();
  atlas.dispose();

  // Между двумя соседними блоками листвы остаётся ровно одна внутренняя грань (без z-fighting дубля).
  const chunk = new Chunk(0, 0);
  chunk.set(5, 20, 5, LEAVES);
  chunk.set(6, 20, 5, LEAVES);
  const mesher = new ChunkMesher();
  const res = mesher.mesh(chunk, () => null);
  assert.ok(res.cutout, 'меш листвы построен');
  const faces = res.cutout!.indices.length / 6;
  assert.equal(faces, 11, 'два соседних блока листвы дают 11 граней (10 внешних + 1 общая внутренняя)');
});
