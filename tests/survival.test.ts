import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mining, Survival } from '../src/player/Survival.ts';
import { AIR, BEDROCK, COBBLESTONE, DIRT, GRASS, STONE, WATER } from '../src/world/Blocks.ts';
import { Player } from '../src/player/Player.ts';
import { World } from '../src/world/World.ts';

const idle = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };

test('survival inventory: drops, finite placement, no bedrock/water/air', () => {
  const s = new Survival();
  assert.equal(s.consumeBlock(DIRT), false);
  assert.equal(s.collect(GRASS), DIRT);
  assert.equal(s.count(DIRT), 1);
  assert.equal(s.collect(STONE), COBBLESTONE);
  assert.equal(s.consumeBlock(DIRT), true);
  assert.equal(s.consumeBlock(DIRT), false);
  assert.equal(s.count(DIRT), 0);
  for (const id of [AIR, BEDROCK, WATER]) assert.equal(s.collect(id), 0);
});

test('food restores hunger, is consumed once, and cannot revive dead player', () => {
  const s = new Survival();
  s.food = 2;
  assert.equal(s.eat(), false);
  s.hunger = 17;
  assert.equal(s.eat(), true);
  assert.equal(s.hunger, 20);
  assert.equal(s.food, 1);
  s.damage(100); s.hunger = 2;
  assert.equal(s.eat(), false);
  assert.equal(s.food, 1);
});

test('hunger: sprint costs more, starvation hurts, eating enables recovery', () => {
  const walk = new Survival(), sprint = new Survival();
  for (let i = 0; i < 600; i++) { walk.update(0.1, true, false, false); sprint.update(0.1, true, true, false); }
  assert.ok(sprint.hunger < walk.hunger);
  sprint.hunger = 0;
  for (let i = 0; i < 41; i++) sprint.update(0.1, false, false, false);
  assert.equal(sprint.health, 19);
  assert.equal(sprint.canSprint, false);
  sprint.hunger = 20;
  for (let i = 0; i < 41; i++) sprint.update(0.1, false, false, false);
  assert.equal(sprint.health, 20);
  assert.equal(sprint.canSprint, true);
});

test('air lasts ten seconds; drowning hurts and surfacing refills air', () => {
  const s = new Survival(); s.hunger = 15;
  for (let i = 0; i < 90; i++) s.update(0.1, false, false, true);
  assert.equal(s.health, 20);
  for (let i = 0; i < 30; i++) s.update(0.1, false, false, true);
  assert.ok(s.health <= 18); assert.equal(s.air, 0);
  for (let i = 0; i < 30; i++) s.update(0.1, false, false, false);
  assert.equal(s.air, 10);
});

test('mining needs repeated strikes; target changes and inactivity reset progress', () => {
  const mining = new Mining();
  assert.equal(mining.strike('a', STONE), false);
  const first = mining.progress;
  mining.strike('a', STONE);
  assert.ok(mining.progress > first);
  mining.strike('b', STONE);
  assert.equal(mining.progress, first);
  mining.update(0.5);
  assert.equal(mining.progress, 0);
  assert.equal(mining.strike('a', DIRT), false);
  assert.equal(mining.strike('a', DIRT), false);
  assert.equal(mining.strike('a', DIRT), true);
});

test('fall distance reported once on landing; water and teleport clear it', () => {
  const world = new World(1), chunk = world.ensureChunk(0, 0);
  chunk.blocks.fill(AIR);
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.setBlock(x, 40, z, STONE);
  const p = new Player(world); p.teleport(8, 50, 8);
  const landings: number[] = [];
  for (let i = 0; i < 120; i++) { p.update(1 / 60, idle, false); if (p.landedDistance > 3) landings.push(p.landedDistance); }
  assert.equal(landings.length, 1);
  assert.ok(Math.abs(landings[0] - 9) < 0.01);
  p.teleport(8, 41, 8); p.update(1 / 60, idle, false);
  assert.equal(p.landedDistance, 0);
  for (let y = 41; y <= 44; y++) world.setBlock(8, y, 8, WATER);
  p.teleport(8.5, 50, 8.5);
  for (let i = 0; i < 240; i++) { p.update(1 / 60, idle, false); assert.ok(p.landedDistance < 3); }
});
