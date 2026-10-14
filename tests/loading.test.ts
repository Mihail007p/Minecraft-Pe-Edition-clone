import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { World } from '../src/world/World.ts';
import { ChunkRenderer } from '../src/render/ChunkRenderer.ts';
import type { ChunkMaterials } from '../src/render/ChunkMaterial.ts';

// Материалы-заглушки: в Node нет WebGL, а ChunkRenderer использует их лишь как ссылки.
const fakeMaterials = { opaque: {}, cutout: {}, water: {} } as unknown as ChunkMaterials;

test('последовательность загрузки завершается: все чанки в радиусе получают меши', () => {
  const R = 3;
  const scene = new Scene();
  const world = new World(2025);
  const renderer = new ChunkRenderer(scene, world, fakeMaterials);
  const spawn = world.gen.findSpawn();
  const total = ChunkRenderer.chunksInRadius(R);
  let frames = 0;
  let done = false;
  while (frames < 2000) {
    frames++;
    const pendingGen = world.update(spawn.x, spawn.z, R, 14);
    renderer.update(spawn.x, spawn.z, R, 14);
    if (pendingGen === 0 && renderer.stats.pending === 0 && renderer.stats.meshed >= total) { done = true; break; }
  }
  assert.ok(done, `загрузка не завершилась за ${frames} кадров: meshed=${renderer.stats.meshed}/${total}, pending=${renderer.stats.pending}`);
  assert.equal(renderer.stats.meshed, total);
  assert.equal(scene.children.length, total);
  console.log(`  кадров до готовности: ${frames}, чанков с мешами: ${total}, треугольников: ${renderer.stats.triangles}`);

  // Перемещение игрока на 3 чанка: новые чанки догружаются, далёкие выгружаются
  const far = spawn.x + 16 * 3;
  for (let i = 0; i < 500; i++) {
    const pg = world.update(far, spawn.z, R, 14);
    renderer.update(far, spawn.z, R, 14);
    if (pg === 0 && renderer.stats.pending === 0 && renderer.stats.meshed >= total) break;
  }
  assert.equal(renderer.stats.meshed, total, 'после перемещения число мешей в радиусе прежнее');
  assert.equal(scene.children.length, total);

  // Изменение блока перестраивает чанк
  const bx = Math.floor(far), bz = Math.floor(spawn.z);
  const h = world.surfaceHeight(bx, bz);
  world.setBlock(bx, h + 1, bz, 1);
  const pending = renderer.update(far, spawn.z, R, 100);
  assert.equal(pending, 0);
  assert.equal(renderer.stats.meshed, total);
  renderer.dispose();
  assert.equal(scene.children.length, 0);
});
