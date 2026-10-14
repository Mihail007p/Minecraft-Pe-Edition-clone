import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.ts';
import { Player } from '../src/player/Player.ts';
import { AIR, STONE, GRASS } from '../src/world/Blocks.ts';
import { PLAYER_HEIGHT, CHUNK_HEIGHT } from '../src/config.ts';

/** Плоский мир из камня до y=40 без генератора — для детерминированных проверок физики. */
function flatWorld(): World {
  const world = new World(1);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const chunk = world.ensureChunk(dx, dz);
    chunk.blocks.fill(AIR);
    for (let y = 0; y <= 40; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.set(x, y, z, y === 40 ? GRASS : STONE);
  }
  return world;
}

const idle = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };
const step = (p: Player, input = idle, seconds = 1, autoJump = true) => {
  for (let i = 0; i < seconds * 60; i++) p.update(1 / 60, input, autoJump);
};

test('игрок падает и останавливается точно на поверхности', () => {
  const world = flatWorld();
  const p = new Player(world);
  p.teleport(8.5, 50, 8.5);
  step(p, idle, 2);
  assert.ok(p.onGround, 'должен стоять на земле');
  assert.ok(Math.abs(p.y - 41) < 0.01, `y=${p.y}, ожидалось ~41`);
  assert.equal(p.vy, 0);
});

test('ходьба вперёд двигает вдоль −Z при yaw=0 и не проваливает под землю', () => {
  const world = flatWorld();
  const p = new Player(world);
  p.teleport(8.5, 41, 8.5);
  step(p, idle, 0.5);
  const z0 = p.z;
  step(p, { ...idle, moveZ: 1 }, 1);
  assert.ok(p.z < z0 - 2, `должен пройти вперёд, сдвиг ${z0 - p.z}`);
  assert.ok(Math.abs(p.x - 8.5) < 0.01, 'не должен уходить вбок');
  assert.ok(p.y >= 41 - 0.001, 'не должен провалиться');
});

test('прыжок поднимает примерно на 1.2 блока и приземляет обратно', () => {
  const world = flatWorld();
  const p = new Player(world);
  p.teleport(8.5, 41, 8.5);
  step(p, idle, 0.5);
  let maxY = p.y;
  for (let i = 0; i < 90; i++) {
    p.update(1 / 60, { ...idle, jump: i < 3 }, false);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY - 41 > 1.0 && maxY - 41 < 1.6, `высота прыжка ${maxY - 41}`);
  assert.ok(Math.abs(p.y - 41) < 0.01 && p.onGround, 'должен приземлиться');
});

test('стена из двух блоков останавливает, один блок — автопрыжок', () => {
  const world = flatWorld();
  // Стена высотой 2 на z=4..., игрок идёт вперёд (к меньшим z)
  for (let x = 0; x < 16; x++) { world.setBlock(x, 41, 4, STONE); world.setBlock(x, 42, 4, STONE); }
  const p = new Player(world);
  p.teleport(8.5, 41, 8.5);
  step(p, idle, 0.3);
  step(p, { ...idle, moveZ: 1 }, 2);
  assert.ok(p.z > 5 + 0.3 - 0.01, `упёрся в стену: z=${p.z}`);
  assert.ok(Math.abs(p.y - 41) < 0.01, 'не должен запрыгнуть на стену в 2 блока');

  // Ступенька в один блок — автопрыжок
  const world2 = flatWorld();
  for (let x = 0; x < 16; x++) world2.setBlock(x, 41, 4, STONE);
  const p2 = new Player(world2);
  p2.teleport(8.5, 41, 8.5);
  step(p2, idle, 0.3);
  step(p2, { ...idle, moveZ: 1 }, 2);
  assert.ok(p2.z < 4, `должен запрыгнуть на ступеньку и пройти дальше: z=${p2.z}`);
  // Без автопрыжка — останавливается
  const p3 = new Player(world2);
  p3.teleport(8.5, 41, 8.5);
  step(p3, idle, 0.3);
  step(p3, { ...idle, moveZ: 1 }, 2, false);
  assert.ok(p3.z > 5, `без автопрыжка должен упереться: z=${p3.z}`);
});

test('полёт: подъём и зависание без гравитации', () => {
  const world = flatWorld();
  const p = new Player(world);
  p.teleport(8.5, 41, 8.5);
  step(p, idle, 0.3);
  p.toggleFly();
  step(p, { ...idle, jump: true }, 1);
  assert.ok(p.y > 44, `должен подняться: y=${p.y}`);
  const y = p.y;
  step(p, idle, 1);
  assert.ok(Math.abs(p.y - y) < 0.8, `в полёте должен зависать (дрейф ${Math.abs(p.y - y).toFixed(2)})`);
  step(p, { ...idle, sneak: true }, 3);
  assert.ok(Math.abs(p.y - 41) < 0.01 && !p.flying, 'снижение до земли выключает полёт');
});

test('потолок останавливает прыжок, высокая скорость не пробивает пол', () => {
  const world = flatWorld();
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) world.setBlock(x, 43, z, STONE);
  const p = new Player(world);
  p.teleport(8.5, 41, 8.5);
  step(p, idle, 0.3);
  step(p, { ...idle, jump: true }, 1);
  assert.ok(p.y + PLAYER_HEIGHT <= 43 + 0.001, `голова не должна войти в потолок: y=${p.y}`);
  const p2 = new Player(world);
  p2.teleport(8.5, CHUNK_HEIGHT - 3, 8.5);
  p2.vy = -200;
  p2.update(1 / 60, idle, true);
  assert.ok(p2.y >= 44 - 0.001, `не должен пробить потолок/пол на высокой скорости: y=${p2.y}`);
});
