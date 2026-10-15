import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/world/World.ts';
import { Player } from '../src/player/Player.ts';
import {
  AIR, GRASS, STONE, TALL_GRASS, WATER, WATER_FALL, WATER_F2,
  isWater, waterLevel,
} from '../src/world/Blocks.ts';

/** Плоский мир: камень до y=40, дёрн сверху — детерминированные проверки воды. */
function flatWorld(): World {
  const world = new World(1);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const chunk = world.ensureChunk(dx, dz);
    chunk.blocks.fill(AIR);
    for (let y = 0; y <= 40; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      chunk.set(x, y, z, y === 40 ? GRASS : STONE);
    }
  }
  return world;
}

const idle = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };
const step = (p: Player, input = idle, seconds = 1) => {
  for (let i = 0; i < seconds * 60; i++) p.update(1 / 60, input, true);
};

// ---------------------------------------------------------------- растекание

test('убранный блок у воды: вода растекается в пустоту и останавливается на 7 уровне', () => {
  const world = flatWorld();
  world.setBlock(6, 41, 8, WATER);   // источник
  for (let z = 0; z <= 16; z++) world.setBlock(7, 41, z, STONE); // плотина через всё русло
  world.water.runUntilIdle();
  assert.equal(world.getBlock(7, 41, 8), STONE, 'до удаления блока вода не должна проходить');
  assert.equal(world.getBlock(8, 41, 8), AIR);

  world.setBlock(7, 41, 8, AIR);     // «убрали блок» в плотине
  world.water.runUntilIdle();
  assert.ok(isWater(world.getBlock(7, 41, 8)), 'пустота должна заполниться водой');
  assert.equal(waterLevel(world.getBlock(7, 41, 8)), 1);
  assert.equal(waterLevel(world.getBlock(8, 41, 8)), 2);
  assert.equal(waterLevel(world.getBlock(9, 41, 8)), 3);
  assert.equal(waterLevel(world.getBlock(13, 41, 8)), 7, 'край разлива — седьмой уровень');
  assert.equal(world.getBlock(14, 41, 8), AIR, 'дальше семи блоков от источника вода не течёт');
  assert.ok(isWater(world.getBlock(5, 41, 8)), 'вода течёт и в другую сторону');
});

test('вода падает вниз столбом и разливается по дну; в воздухе вбок не течёт', () => {
  const world = flatWorld();
  // Источник в каменном «колодце» — вода может уйти только вниз.
  world.setBlock(8, 45, 8, WATER);
  for (const [x, z] of [[7, 8], [9, 8], [8, 7], [8, 9]]) world.setBlock(x, 45, z, STONE);
  world.water.runUntilIdle();
  assert.equal(world.getBlock(8, 44, 8), WATER_FALL);
  assert.equal(world.getBlock(8, 43, 8), WATER_FALL);
  assert.equal(world.getBlock(8, 42, 8), WATER_FALL);
  assert.equal(waterLevel(world.getBlock(8, 41, 8)), 1, 'на дне — разлив уровнем 1');
  assert.equal(world.getBlock(9, 44, 8), AIR, 'падающий столб не растекается вбок в воздухе');
  assert.equal(world.getBlock(9, 43, 8), AIR);
  assert.equal(waterLevel(world.getBlock(9, 41, 8)), 2);
  assert.equal(waterLevel(world.getBlock(14, 41, 8)), 7);
  assert.equal(world.getBlock(15, 41, 8), AIR);
});

test('без источника текущая вода высыхает', () => {
  const world = flatWorld();
  world.setBlock(6, 41, 8, WATER);
  world.water.runUntilIdle();
  assert.ok(isWater(world.getBlock(9, 41, 8)), 'сначала вода растеклась');
  world.setBlock(6, 41, 8, AIR); // источник убран
  world.water.runUntilIdle();
  for (let x = 6; x <= 14; x++) {
    assert.equal(world.getBlock(x, 41, 8), AIR, `ячейка ${x},41,8 должна высохнуть`);
  }
});

test('поставленный блок перекрывает растекание; убрали — вода снова течёт', () => {
  const world = flatWorld();
  world.setBlock(6, 41, 8, WATER);
  for (let z = 0; z <= 16; z++) world.setBlock(7, 41, z, STONE);
  world.water.runUntilIdle();
  world.setBlock(7, 41, 8, AIR);
  world.water.runUntilIdle();
  assert.equal(waterLevel(world.getBlock(8, 41, 8)), 2);

  world.setBlock(7, 41, 8, STONE); // снова перекрыли
  world.water.runUntilIdle();
  assert.equal(world.getBlock(8, 41, 8), AIR, 'за плотиной вода должна высохнуть');
  assert.ok(isWater(world.getBlock(5, 41, 8)), 'с другой стороны источника вода остаётся');

  world.setBlock(7, 41, 8, AIR); // и снова пошла
  world.water.runUntilIdle();
  assert.equal(waterLevel(world.getBlock(8, 41, 8)), 2);
});

test('вода вытесняет траву при растекании, дальние растения не трогает', () => {
  const world = flatWorld();
  world.setBlock(7, 41, 8, TALL_GRASS);
  world.setBlock(15, 41, 8, TALL_GRASS);
  world.setBlock(6, 41, 8, WATER);
  world.water.runUntilIdle();
  assert.ok(isWater(world.getBlock(7, 41, 8)), 'трава у воды вытесняется');
  assert.equal(world.getBlock(15, 41, 8), TALL_GRASS, 'далеко от разлива трава цела');
});

test('текущая вода не твёрдая: физика её пропускает, игрок чувствует воду', () => {
  const world = flatWorld();
  world.setBlock(6, 41, 8, WATER);
  world.setBlock(7, 41, 8, STONE);
  world.water.runUntilIdle();
  world.setBlock(7, 41, 8, AIR);
  world.water.runUntilIdle();
  const flow = world.getBlock(7, 41, 8);
  assert.ok(isWater(flow) && flow !== WATER, 'ожидалась текущая вода');
  assert.equal(world.isSolidForPhysics(7, 41, 8), false);

  // Текущая вода и над головой: задыхаться можно и в ней.
  world.setBlock(7, 42, 8, WATER_F2);
  const p = new Player(world);
  p.teleport(7.5, 41.2, 8.5);
  p.update(1 / 60, idle, true);
  assert.equal(p.inWater, true);
  assert.equal(p.headInWater, true);
});

// ---------------------------------------------------------------- плавание

/** Котлован с водой y=41..43 (z=8..14) и берег-полка y=41..43 (z=-8..7, верх 44). */
function waterWorld(): World {
  const world = flatWorld();
  for (let z = -8; z <= 7; z++) for (let x = 3; x <= 13; x++) for (let y = 41; y <= 43; y++) {
    world.setBlock(x, y, z, STONE); // берег
  }
  for (let x = 3; x <= 13; x++) for (let y = 41; y <= 43; y++) world.setBlock(x, y, 15, STONE);
  for (let z = 8; z <= 14; z++) for (let y = 41; y <= 43; y++) {
    world.setBlock(3, y, z, STONE);
    world.setBlock(13, y, z, STONE);
  }
  for (let z = 8; z <= 14; z++) for (let x = 4; x <= 12; x++) for (let y = 41; y <= 43; y++) {
    world.setBlock(x, y, z, WATER); // столбик источников, как у генератора океана
  }
  world.water.runUntilIdle();
  assert.ok(isWater(world.getBlock(8, 43, 12)), 'котлован должен остаться наполненным');
  return world;
}

test('плавучесть: без управления игрок всплывает и держит голову над водой, sneak — ныряет', () => {
  const world = waterWorld();
  const p = new Player(world);
  p.teleport(8.5, 41.2, 12.5);
  step(p, idle, 2);
  assert.ok(p.y > 42.3, `должен всплыть к поверхности: y=${p.y}`);
  assert.equal(p.headInWater, false, 'голова должна быть над водой');

  step(p, { ...idle, sneak: true }, 2);
  assert.ok(p.y < 41.6, `sneak должен нырять ко дну: y=${p.y}`);
  assert.equal(p.headInWater, true, 'под водой голова в воде');
});

test('прыжок из воды: у дна и у поверхности игрок выпрыгивает наружу', () => {
  const world = waterWorld();
  const p = new Player(world);
  p.teleport(8.5, 41.2, 12.5);
  let maxY = p.y;
  for (let i = 0; i < 180; i++) {
    p.update(1 / 60, { ...idle, jump: true }, true);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY > 44.2, `должен выпрыгнуть из воды (максимум y=${maxY})`);
});

test('после плавания персонаж спокойно залазит на берег и не взлетает выше платформы', () => {
  const world = waterWorld();
  const p = new Player(world);
  p.teleport(8.5, 43.2, 12.5);
  let maxY = p.y;
  for (let i = 0; i < 3 * 60; i++) {
    p.update(1 / 60, { ...idle, moveZ: 1 }, true);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(p.onGround, 'должен стоять на берегу');
  assert.ok(Math.abs(p.y - 44) < 0.1, `должен залезть на полку (верх 44): y=${p.y}`);
  assert.ok(maxY <= 44.05, `не должен взлетать выше верха берега: максимум y=${maxY}`);
  assert.ok(p.z < 8.5, `должен выйти на сушу: z=${p.z}`);
  assert.equal(p.inWater, false);
});

test('при подъёме из глубокой воды на двухблочный берег игрок останавливается на его поверхности', () => {
  const world = waterWorld();
  for (let z = -8; z <= 7; z++) for (let x = 3; x <= 13; x++) world.setBlock(x, 44, z, STONE);
  const p = new Player(world);
  p.teleport(8.5, 43.2, 12.5);
  let maxY = p.y;
  for (let i = 0; i < 4 * 60; i++) {
    p.update(1 / 60, { ...idle, moveZ: 1 }, true);
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(p.onGround, 'должен стоять на высоком берегу');
  assert.ok(Math.abs(p.y - 45) < 0.1, `должен залезть на верх y=45: y=${p.y}`);
  assert.ok(maxY <= 45.05, `не должен перелетать выше целевой поверхности: максимум y=${maxY}`);
  assert.ok(p.z < 8.5, `должен выйти на сушу: z=${p.z}`);
});

test('залезть на берег можно и с кнопкой прыжка без автопрыжка', () => {
  const world = waterWorld();
  const p = new Player(world);
  p.teleport(8.5, 43.2, 12.5);
  // Прыжок вытаскивает из воды, затем докатываемся на берег обычным шагом.
  for (let i = 0; i < 2.5 * 60; i++) p.update(1 / 60, { ...idle, moveZ: 1, jump: true }, false);
  for (let i = 0; i < 1.5 * 60; i++) p.update(1 / 60, { ...idle, moveZ: 1 }, false);
  assert.ok(p.onGround, 'должен стоять на берегу');
  assert.ok(Math.abs(p.y - 44) < 0.1, `должен залезть на полку: y=${p.y}`);
  assert.ok(p.z < 8.5, `должен выйти на сушу: z=${p.z}`);
});

test('без автопрыжка и прыжка берег удерживает игрока в воде', () => {
  const world = waterWorld();
  const p = new Player(world);
  p.teleport(8.5, 43.2, 12.5);
  for (let i = 0; i < 4 * 60; i++) p.update(1 / 60, { ...idle, moveZ: 1 }, false);
  assert.ok(p.z > 8, `не должен сам залезть на берег: z=${p.z}`);
  assert.ok(p.y < 43.9, `должен остаться в воде: y=${p.y}`);
});
