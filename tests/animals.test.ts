import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { Animal, animalRayDistance } from '../src/entities/Animal.ts';
import { Animals } from '../src/entities/Animals.ts';
import { World } from '../src/world/World.ts';
import { AIR, GRASS, STONE, WATER } from '../src/world/Blocks.ts';

function flatWorld(): World {
  const world = new World(42);
  for (let cx = -2; cx <= 2; cx++) for (let cz = -2; cz <= 2; cz++) {
    const chunk = world.ensureChunk(cx, cz); chunk.blocks.fill(AIR);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      chunk.set(x, 40, z, GRASS); chunk.set(x, 39, z, STONE);
    }
  }
  return world;
}

const walker = () => { const a = new Animal('cow', 5.5, 41, 5.5, () => 0.5); a.yaw = a.targetYaw = 0; return a; };

test('animal walks with distance-based gait and gradual turn, flees after damage', () => {
  const world = flatWorld(), a = walker();
  for (let i = 0; i < 120; i++) a.update(1 / 60, world, [a]);
  assert.ok(a.z > 6.5); assert.equal(a.y, 41); assert.ok(a.gait > 0);
  const yaw = a.yaw;
  assert.equal(a.hit(a.x - 2, a.z), false);
  a.update(1 / 60, world, [a]);
  assert.ok(a.yaw > yaw && a.yaw - yaw < 0.05);
  assert.ok(a.panic > 0); assert.equal(a.health, 6);
  a.hit(0, 0); a.hit(0, 0); assert.equal(a.hit(0, 0), true);
});

test('animal footprint respects walls, water, cliffs, steps and unloaded chunks', () => {
  const world = flatWorld(), a = walker();
  assert.equal(a.ground(world, 6, 6), 41);
  for (let x = 0; x < 16; x++) { world.setBlock(x, 41, 8, STONE); world.setBlock(x, 42, 8, STONE); }
  assert.equal(a.ground(world, 5.5, 7.5), null, 'two-block wall');
  for (let x = 0; x < 16; x++) world.setBlock(x, 42, 8, AIR);
  assert.equal(a.ground(world, 5.5, 7.5), 42, 'one-block step');
  world.setBlock(5, 41, 5, WATER);
  assert.equal(a.ground(world, 5.5, 5.5), null, 'water');
  world.setBlock(5, 41, 5, AIR);
  world.setBlock(6, 40, 6, AIR); world.setBlock(6, 39, 6, AIR);
  assert.equal(a.ground(world, 5.5, 5.5), null, 'cliff under footprint');
  assert.equal(a.ground(world, 1000, 1000), null, 'unloaded');
});

test('animal falls when floor is removed, ray target cannot pass blocking distance', () => {
  const world = flatWorld(), a = walker();
  for (let x = 3; x < 9; x++) for (let z = 3; z < 9; z++) { world.setBlock(x, 40, z, AIR); world.setBlock(x, 39, z, AIR); world.setBlock(x, 36, z, STONE); }
  for (let i = 0; i < 120; i++) a.update(1 / 60, world, [a]);
  assert.ok(a.y >= 37 && a.y < 38);
  assert.notEqual(animalRayDistance(a, [a.x, a.y + 0.5, a.z - 4], [0, 0, 1], 5), null);
  assert.equal(animalRayDistance(a, [a.x, a.y + 0.5, a.z - 4], [0, 0, 1], 2), null);
  assert.equal(animalRayDistance(a, [a.x + 3, a.y, a.z], [0, 0, 1], 5), null);
});

test('herd is bounded, spawns all species on land, and releases scene objects', () => {
  const world = flatWorld(), scene = new Scene(), herd = new Animals(scene, world);
  herd.populate(0, 0);
  assert.equal(herd.animals.length, 12);
  assert.equal(new Set(herd.animals.map(a => a.kind)).size, 3);
  herd.populate(0, 0); assert.equal(herd.animals.length, 12);
  for (const a of herd.animals) assert.equal(a.y, 41);
  for (let i = 0; i < 10; i++) herd.update(1 / 60, 0, 0);
  assert.equal(scene.children.length, 12);
  herd.dispose(); assert.equal(scene.children.length, 0); assert.equal(herd.animals.length, 0);
});
