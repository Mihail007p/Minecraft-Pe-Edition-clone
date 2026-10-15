import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, Vector3, type Object3D } from 'three';
import { PlayerModel, cameraPoseForView } from '../src/render/PlayerModel.ts';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, THIRD_PERSON_DISTANCE } from '../src/config.ts';
import { Settings } from '../src/core/Settings.ts';
import { Player } from '../src/player/Player.ts';
import { World } from '../src/world/World.ts';
import { AIR, GRASS, STONE, WATER } from '../src/world/Blocks.ts';
import { SettingsPanel } from '../src/ui/Menus.ts';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';

const pose = { x: 10, y: 41, z: 10, yaw: 0, pitch: 0 };

test('камера от первого лица находится в глазах игрока', () => {
  const cam = cameraPoseForView('first', pose);
  assert.deepEqual(cam.position, [10, 41 + 1.62, 10]);
  assert.equal(cam.yaw, 0);
  assert.equal(cam.pitch, 0);
});

test('камера от третьего лица сзади отодвинута против взгляда, спереди — навстречу', () => {
  // yaw=0 — взгляд вдоль −Z: сзади камера на +Z, спереди на −Z.
  const back = cameraPoseForView('third-back', pose);
  assert.ok(Math.abs(back.position[2] - (10 + THIRD_PERSON_DISTANCE)) < 1e-9, `z=${back.position[2]}`);
  assert.equal(back.yaw, 0);

  const front = cameraPoseForView('third-front', pose);
  assert.ok(Math.abs(front.position[2] - (10 - THIRD_PERSON_DISTANCE)) < 1e-9, `z=${front.position[2]}`);
  assert.ok(Math.abs(front.yaw - Math.PI) < 1e-9, 'камера спереди смотрит в лицо игроку');
});

test('камера от третьего лица укорачивает дистанцию перед стеной', () => {
  // Стена сразу за спиной игрока (z >= 12 при взгляде вдоль −Z).
  const cam = cameraPoseForView('third-back', pose, (_x, _y, z) => z >= 12);
  assert.ok(cam.position[2] < 12, `камера не должна уйти в стену: z=${cam.position[2]}`);
  assert.ok(cam.position[2] > 10, 'но должна остаться позади глаз');
});

test('модель игрока детальная: именованные части тела, одежда и рюкзак', () => {
  const model = new PlayerModel();
  const names = new Set<string>();
  let meshes = 0;
  model.root.traverse((obj) => {
    if (obj.name) names.add(obj.name);
    if (obj instanceof Mesh) meshes++;
  });
  for (const part of ['head', 'skull', 'hair-top', 'fringe', 'ear-left', 'ear-right', 'ear-inner-left', 'ear-inner-right',
    'nose-bridge', 'nose-tip', 'nose-shadow', 'torso', 'chest', 'belt', 'buckle', 'backpack', 'bedroll',
    'arm-left', 'arm-right', 'elbow-left', 'elbow-right', 'forearm', 'hand-left', 'hand-right', 'finger-left-1',
    'leg-left', 'leg-right', 'knee-left', 'knee-right', 'shin', 'kneepad', 'shoe']) {
    assert.ok(names.has(part), `в модели не хватает детали «${part}»`);
  }
  assert.ok(meshes >= 70, `модель слишком простая: всего ${meshes} мешей`);
  model.dispose();
});

test('анимация моргания проходит через полуоткрытые и закрытые веки', () => {
  const model = new PlayerModel();
  const skull = model.root.getObjectByName('skull') as Mesh;
  const openFace = skull.material;
  const seenFaces = new Set<unknown>([openFace]);
  const player = {
    x: 0, y: 41, z: 0, yaw: 0, pitch: 0,
    vx: 0, vy: 0, vz: 0, onGround: true, flying: false, inWater: false,
  };
  for (let i = 0; i < 150; i++) {
    model.update(1 / 60, player);
    seenFaces.add(skull.material);
  }
  assert.equal(seenFaces.size, 3, 'глаза используют открытое, полуоткрытое и закрытое состояние');
  assert.equal(skull.material, openFace, 'после моргания глаза снова открыты');
  model.dispose();
});

test('анимация модели: при ходьбе ноги и руки машут, голова смотрит по pitch', () => {
  const model = new PlayerModel();
  const player = {
    x: 0, y: 41, z: 0, yaw: 0.5, pitch: 0.4,
    vx: 0, vy: 0, vz: -4.3, onGround: true, flying: false, inWater: false,
  };
  // Несколько кадров ходьбы — фаза шага должна сдвинуться от нейтральной позы.
  for (let i = 0; i < 20; i++) model.update(1 / 60, player);
  const legL = model.root.getObjectByName('leg-left')!;
  const legR = model.root.getObjectByName('leg-right')!;
  const elbowL = model.root.getObjectByName('elbow-left')!;
  const kneeL = model.root.getObjectByName('knee-left')!;
  const kneeR = model.root.getObjectByName('knee-right')!;
  const head = model.root.getObjectByName('head')!;
  assert.ok(Math.abs(legL.rotation.x) > 0.05, `нога должна махать: ${legL.rotation.x}`);
  assert.ok(Math.sign(legL.rotation.x) === -Math.sign(legR.rotation.x), 'ноги машут в противофазе');
  assert.ok(elbowL.rotation.x > 0.05, 'локоть сгибается при ходьбе');
  assert.ok(kneeL.rotation.x + kneeR.rotation.x < 0, 'колени сгибаются назад — поднимается пятка');
  assert.ok(Math.abs(head.rotation.x - 0.4 * 0.85) < 1e-9, 'голова наклоняется за взглядом');
  assert.ok(Math.abs(model.root.position.y - 41) < 1e-9, 'модель стоит на ногах игрока');
  assert.ok(Math.abs(model.root.rotation.y - 0.5) < 1e-9, 'модель повёрнута по yaw');

  // Взмах рукой при добыче.
  model.swingArm();
  model.update(0.1, { ...player, vx: 0, vz: 0 });
  const armR = model.root.getObjectByName('arm-right')!;
  assert.ok(armR.rotation.x > 0.4, `рука должна взмахнуть: ${armR.rotation.x}`);
  model.dispose();
});

// ---------------------------------------------------------------- плавание

const SURFACE = 46.875;
/** Игрок на плаву у поверхности: ступни на WATER_FLOAT_DEPTH ниже воды, он плывёт вперёд (−Z). */
const swimPose = (over: Record<string, unknown> = {}) => ({
  x: 0, y: SURFACE - 1.3, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0.25, vz: -3,
  onGround: false, flying: false, inWater: true, headInWater: false, waterSurfaceY: SURFACE, ...over,
});
const named = (model: PlayerModel, name: string): Object3D[] => {
  const found: Object3D[] = [];
  model.root.traverse((o) => { if (o.name === name) found.push(o); });
  return found;
};
const worldOf = (obj: Object3D, local = new Vector3()): Vector3 => obj.localToWorld(local.clone());
const run = (model: PlayerModel, pose: ReturnType<typeof swimPose>, seconds: number, each?: () => void): void => {
  for (let i = 0; i < seconds * 60; i++) {
    model.update(1 / 60, pose);
    model.root.updateWorldMatrix(true, true);
    each?.();
  }
};
const correlate = (a: number[], b: number[]): number => {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return sab / Math.sqrt(saa * sbb);
};

test('в воде у поверхности пловец лежит на воде: тело горизонтально, спина у ватерлинии, голова впереди, ноги сзади', () => {
  const model = new PlayerModel();
  run(model, swimPose(), 2);
  const body = model.root.getObjectByName('animated-body')!;
  assert.ok(Math.abs(body.rotation.x + Math.PI / 2) < 0.2, `корпус горизонтален: наклон ${body.rotation.x}`);
  const hips = worldOf(model.root.getObjectByName('torso')!);
  const head = worldOf(model.root.getObjectByName('head')!);
  const [shoeL, shoeR] = named(model, 'shoe').map((o) => worldOf(o));
  assert.ok(Math.abs(hips.y - (SURFACE - 0.05)) < 0.07, `ось тела у самой воды: ${(SURFACE - hips.y).toFixed(2)} ниже поверхности`);
  assert.ok(head.z < hips.z - 0.6, 'голова впереди таза (по −Z)');
  assert.ok(shoeL.z > hips.z + 0.5 && shoeR.z > hips.z + 0.5, 'ноги вытянуты назад');
  assert.ok(Math.abs(head.y - SURFACE) < 0.25, 'голова у ватерлинии, а не высоко над водой и не глубоко под ней');
  assert.ok(Math.abs(shoeL.y - hips.y) < 0.4 && Math.abs(shoeR.y - hips.y) < 0.4, 'ноги трепещут на уровне таза, не провисают');
  model.dispose();
});

test('на месте пловец стоит на воде: вертикально, вода у шеи, голова снаружи, ноги глубоко', () => {
  const model = new PlayerModel();
  run(model, swimPose({ vz: 0, vy: 0 }), 2);
  const body = model.root.getObjectByName('animated-body')!;
  assert.ok(body.rotation.x > 0 && body.rotation.x < 0.2, `корпус вертикален, чуть откинут назад: ${body.rotation.x}`);
  const head = worldOf(model.root.getObjectByName('head')!);
  const skullTop = worldOf(model.root.getObjectByName('skull')!, new Vector3(0, 0.21, 0));
  assert.ok(head.y > SURFACE - 0.05, `шея у воды, голова над ней: y=${head.y.toFixed(2)}`);
  assert.ok(skullTop.y > SURFACE + 0.3, 'макушка заметно над водой');
  for (const shoe of named(model, 'shoe')) assert.ok(worldOf(shoe).y < SURFACE - 0.9, 'ступни глубоко под водой');
  model.dispose();
});

test('кроль в мировых координатах: кисти поочерёдно выходят из воды, а ноги бьют в противофазе', () => {
  const model = new PlayerModel();
  const pose = swimPose();
  run(model, pose, 2);
  const handL = model.root.getObjectByName('hand-left')!;
  const handR = model.root.getObjectByName('hand-right')!;
  const [shoeL, shoeR] = named(model, 'shoe');
  const kneeL = model.root.getObjectByName('knee-left')!;
  const kneeR = model.root.getObjectByName('knee-right')!;
  const hy: number[][] = [[], []];
  const sy: number[][] = [[], []];
  let maxKnee = -Infinity;
  let minKnee = Infinity;
  run(model, pose, 3, () => {
    hy[0].push(worldOf(handL).y);
    hy[1].push(worldOf(handR).y);
    sy[0].push(worldOf(shoeL).y);
    sy[1].push(worldOf(shoeR).y);
    maxKnee = Math.max(maxKnee, kneeL.rotation.x, kneeR.rotation.x);
    minKnee = Math.min(minKnee, kneeL.rotation.x, kneeR.rotation.x);
  });
  assert.ok(maxKnee < 0.02, `колени никогда не сгибаются вперёд (максимум ${maxKnee.toFixed(3)})`);
  assert.ok(minKnee < -0.3, `колено сгибается назад в начале удара вниз (${minKnee.toFixed(2)})`);
  const above = hy.map((series) => series.filter((y) => y > SURFACE).length / series.length);
  assert.ok(above[0] > 0.15 && above[0] < 0.45 && above[1] > 0.15 && above[1] < 0.45,
    `каждая кисть проводит над водой 15–45% цикла (вынос), а не всё время: ${above.map((v) => v.toFixed(2))}`);
  const both = hy[0].filter((y, i) => y > SURFACE && hy[1][i] > SURFACE).length / hy[0].length;
  assert.ok(both < 0.1, `обе кисти над водой одновременно в ${(both * 100).toFixed(0)}% кадров`);
  assert.ok(correlate(hy[0], hy[1]) < -0.8, `руки сдвинуты на полцикла: высоты кистей в противофазе (${correlate(hy[0], hy[1]).toFixed(2)})`);
  assert.ok(correlate(sy[0], sy[1]) < -0.9, `ноги бьют в противофазе: ${correlate(sy[0], sy[1]).toFixed(2)}`);
  const range = Math.max(...sy[1]) - Math.min(...sy[1]);
  assert.ok(range > 0.25 && range < 0.6, `размах удара ноги ${range.toFixed(2)} блока — как у настоящего флаттера`);
  model.dispose();
});

test('дыхание в кроле: голова поворачивается к воздуху, рот выходит из воды, голова не поднимается', () => {
  const model = new PlayerModel();
  const head = model.root.getObjectByName('head')!;
  const skull = model.root.getObjectByName('skull')!;
  run(model, swimPose(), 2);
  let maxTurn = 0;
  let mouthUp = -1;
  let mouthDown = 1;
  let maxHeadTop = -1;
  run(model, swimPose(), 4, () => {
    maxTurn = Math.max(maxTurn, Math.abs(head.rotation.y));
    const mouth = worldOf(head, new Vector3(0, 0.09, -0.2)).y - SURFACE;
    mouthUp = Math.max(mouthUp, mouth);
    mouthDown = Math.min(mouthDown, mouth);
    maxHeadTop = Math.max(maxHeadTop, worldOf(skull, new Vector3(0, 0.21, 0)).y - SURFACE);
  });
  assert.ok(maxTurn > 0.9, `голова поворачивается на вдох: ${maxTurn.toFixed(2)} рад`);
  assert.ok(mouthUp > 0.02, `на вдохе рот выходит из воды: ${mouthUp.toFixed(2)}`);
  assert.ok(mouthDown < -0.03, `между вдохами лицо в воде: ${mouthDown.toFixed(2)}`);
  assert.ok(maxHeadTop < 0.5, `голова не задирается над водой: макушка выше ватерлинии на ${maxHeadTop.toFixed(2)}`);
  model.dispose();

  // Под водой (голова в воде) вдохов нет.
  const diver = new PlayerModel();
  const diverHead = diver.root.getObjectByName('head')!;
  let turn = 0;
  run(diver, swimPose({ headInWater: true, y: SURFACE - 3, vy: 0.3 }), 4, () => { turn = Math.max(turn, Math.abs(diverHead.rotation.y)); });
  assert.ok(turn < 0.05, 'под водой голова не поворачивается на вдох');
  diver.dispose();
});

test('нырок: вертикально вниз — вниз головой, руки вытянуты вперёд; всплытие — вертикально', () => {
  const model = new PlayerModel();
  run(model, swimPose({ vz: 0, vy: -2.6, y: SURFACE - 3, headInWater: true }), 2);
  const hips = worldOf(model.root.getObjectByName('torso')!);
  const head = worldOf(model.root.getObjectByName('head')!);
  const [shoeL, shoeR] = named(model, 'shoe').map((o) => worldOf(o));
  assert.ok(head.y < hips.y - 0.6, 'голова внизу, нырнули головой вперёд');
  assert.ok(shoeL.y > hips.y + 0.4 && shoeR.y > hips.y + 0.4, 'ноги наверху');
  const hand = worldOf(model.root.getObjectByName('hand-right')!);
  assert.ok(hand.y < head.y + 0.2, 'руки вытянуты над головой по ходу нырка (вниз)');
  model.dispose();

  const riser = new PlayerModel();
  run(riser, swimPose({ vz: 0, vy: 1.6, y: SURFACE - 3, headInWater: true }), 2);
  const h2 = worldOf(riser.root.getObjectByName('head')!);
  const p2 = worldOf(riser.root.getObjectByName('torso')!);
  assert.ok(h2.y > p2.y + 0.6, 'при всплытии голова наверху, корпус вертикален');
  riser.dispose();
});

test('курс пловца: плывёт боком — разворачивается по движению, на месте смотрит по взгляду', () => {
  const model = new PlayerModel();
  run(model, swimPose({ vx: -3, vz: 0, yaw: 0 }), 2);
  assert.ok(Math.abs(model.root.rotation.y - Math.PI / 2) < 0.1, `плывёт влево, модель смотрит влево: ${model.root.rotation.y}`);
  run(model, swimPose({ vx: 0, vz: 0, vy: 0, yaw: 0.4 }), 3);
  assert.ok(Math.abs(model.root.rotation.y - 0.4) < 0.05, 'остановился — снова смотрит по взгляду');
  model.dispose();
});

test('выйдя из воды, персонаж возвращается в обычную позу без остаточных поворотов', () => {
  const model = new PlayerModel();
  run(model, swimPose(), 3);
  const land = { x: 0, y: 44, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0, onGround: true, flying: false, inWater: false };
  run(model, land as ReturnType<typeof swimPose>, 3);
  const body = model.root.getObjectByName('animated-body')!;
  assert.ok(Math.abs(body.rotation.x) < 0.01 && Math.abs(body.rotation.y) < 0.01 && Math.abs(body.rotation.z) < 0.01, 'корпус выпрямлен');
  assert.ok(Math.abs(body.position.y - 0.68) < 0.02 && Math.abs(body.position.z) < 0.01, 'корпус вернулся на место');
  for (const name of ['leg-left', 'leg-right', 'arm-left', 'arm-right', 'head', 'torso']) {
    const o = model.root.getObjectByName(name)!;
    assert.ok(Math.abs(o.rotation.y) < 0.01, `${name}: нет остаточного поворота по Y (${o.rotation.y})`);
  }
  for (const name of ['leg-left', 'leg-right']) {
    assert.ok(Math.abs(model.root.getObjectByName(name)!.rotation.z) < 0.01, `${name}: ноги не разведены`);
  }
  for (const shoe of named(model, 'shoe')) assert.ok(Math.abs(shoe.rotation.x) < 0.01, 'стопы снова под прямым углом к голени');
  assert.ok(Math.abs(model.root.rotation.y) < 0.01, 'курс снова по взгляду');
  model.dispose();
});

test('блок в руке прячется, пока руки заняты гребком, и возвращается на суше и в стойке на воде', async () => {
  const { GRASS } = await import('../src/world/Blocks.ts');
  const model = new PlayerModel();
  model.setHeldBlock(GRASS);
  const held = model.root.getObjectByName('held-item') as Mesh;
  run(model, swimPose({ vz: 0, vy: 0 }), 1);
  assert.equal(held.visible, true, 'в стойке на воде блок в руке');
  run(model, swimPose(), 2);
  assert.equal(held.visible, false, 'в кроле руки заняты гребком');
  run(model, { ...swimPose(), onGround: true, inWater: false, vz: 0, vy: 0 }, 1);
  assert.equal(held.visible, true, 'на суше блок снова в руке');
  model.dispose();
});

test('взмах рукой в стойке на воде работает, в кроле рука занята гребком; на дне — обычная походка', () => {
  const model = new PlayerModel();
  const armR = model.root.getObjectByName('arm-right')!;
  run(model, swimPose({ vz: 0, vy: 0 }), 1.5);
  const before = armR.rotation.x;
  model.swingArm();
  model.update(0.1, swimPose({ vz: 0, vy: 0 }));
  assert.ok(armR.rotation.x > before + 0.4, `рука бьёт стоя на воде: ${before.toFixed(2)} → ${armR.rotation.x.toFixed(2)}`);
  model.dispose();

  const waderModel = new PlayerModel();
  const wader = { ...swimPose(), onGround: true, vz: -2 };
  for (let i = 0; i < 20; i++) waderModel.update(1 / 60, wader);
  const wadingBody = waderModel.root.getObjectByName('animated-body')!;
  const wadingLeft = waderModel.root.getObjectByName('leg-left')!;
  const wadingRight = waderModel.root.getObjectByName('leg-right')!;
  const wadingKneeL = waderModel.root.getObjectByName('knee-left')!;
  const wadingKneeR = waderModel.root.getObjectByName('knee-right')!;
  assert.ok(Math.abs(wadingBody.rotation.x) < 0.02, 'на дне персонаж остаётся вертикальным');
  assert.ok(wadingLeft.rotation.x * wadingRight.rotation.x < 0, 'по дну он действительно шагает');
  assert.ok(Math.abs(wadingLeft.rotation.x) < 0.5, 'шаг в воде короче, чем на суше');
  assert.ok(wadingKneeL.rotation.x + wadingKneeR.rotation.x < 0, 'и по дну колени сгибаются назад');
  waderModel.dispose();
});

test('связка с физикой: настоящий Player плывёт, и модель ложится на воду, а остановившись — встаёт на ней', () => {
  // Озеро 21×21 блок, вода y=41..46 (видимая поверхность 46.875), под ним камень.
  const world = new World(1);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const chunk = world.ensureChunk(dx, dz);
    chunk.blocks.fill(AIR);
    for (let y = 0; y <= 40; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.set(x, y, z, y === 40 ? GRASS : STONE);
  }
  for (let z = -10; z <= 10; z++) for (let x = -10; x <= 10; x++) for (let y = 41; y <= 46; y++) world.setBlock(x, y, z, WATER);
  const player = new Player(world);
  player.teleport(-8.5, 44, 0.5);
  player.yaw = -Math.PI / 2; // вперёд = +X
  const model = new PlayerModel();
  const idle = { moveX: 0, moveZ: 0, jump: false, sneak: false, sprint: false };
  const advance = (seconds: number, moveZ: number): void => {
    for (let i = 0; i < seconds * 60; i++) {
      player.update(1 / 60, { ...idle, moveZ }, true);
      model.update(1 / 60, player); // Player передаётся как есть: имена полей воды должны совпасть
    }
    model.root.updateWorldMatrix(true, true);
  };
  const body = model.root.getObjectByName('animated-body')!;

  advance(4, 0);
  assert.equal(typeof player.waterSurfaceY, 'number', 'игрок передаёт модели высоту воды');
  const surface = player.waterSurfaceY!;
  assert.ok(body.rotation.x > 0 && body.rotation.x < 0.2, `остановился — стоит на воде вертикально: ${body.rotation.x}`);
  assert.ok(worldOf(model.root.getObjectByName('head')!).y > surface - 0.05, 'голова над водой');

  advance(2, 1);
  assert.ok(body.rotation.x < -1.3, `плывёт — лежит горизонтально: ${body.rotation.x}`);
  const hips = worldOf(model.root.getObjectByName('torso')!);
  assert.ok(Math.abs(hips.y - (surface - 0.05)) < 0.1, `ось тела у ватерлинии: ${(surface - hips.y).toFixed(2)} ниже воды`);
  assert.ok(Math.abs(model.root.rotation.y + Math.PI / 2) < 0.1, 'плывёт головой вперёд, по ходу движения');
  assert.equal(player.headInWater, false);

  advance(3, 0);
  assert.ok(body.rotation.x > 0 && body.rotation.x < 0.2, `снова стоит на воде: ${body.rotation.x}`);
  model.dispose();
});

test('модель принимает простую позу без сведений о воде (как раньше) и не ломается', () => {
  const model = new PlayerModel();
  const plain = { x: 0, y: 41, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: -3, onGround: false, flying: false, inWater: true };
  for (let i = 0; i < 120; i++) model.update(1 / 60, plain);
  model.root.updateWorldMatrix(true, true);
  model.root.traverse((o) => {
    const e = o.matrixWorld.elements;
    assert.ok(e.every(Number.isFinite), `${o.name}: матрица должна быть конечной`);
  });
  const body = model.root.getObjectByName('animated-body')!;
  assert.ok(body.rotation.x < -1.2, 'плывёт горизонтально и без сведений о воде');
  model.dispose();
});

test('в руке модели — выбранный блок с текстурами, пустая рука без блока', async () => {
  const { GRASS, LEAVES, AIR } = await import('../src/world/Blocks.ts');
  const model = new PlayerModel();
  const held = model.root.getObjectByName('held-item') as Mesh;
  assert.ok(held, 'место предмета в руке есть');
  assert.equal(held.visible, false, 'сначала рука пуста');
  model.setHeldBlock(GRASS);
  assert.equal(held.visible, true, 'блок появился в руке');
  assert.ok(Array.isArray(held.material) && held.material.length === 6, 'у мини-куба шесть граней с текстурами');
  model.setHeldBlock(LEAVES);
  const leafMats = held.material as { transparent: boolean; alphaTest: number }[];
  assert.ok(leafMats.every((m) => m.transparent && m.alphaTest === 0.5), 'листва в руке прозрачная');
  model.setHeldBlock(AIR);
  assert.equal(held.visible, false, 'пустой слот — пустая рука');
  model.dispose();
});

test('настройка вида камеры по умолчанию — первое лицо, значение валидно', () => {
  assert.equal(DEFAULT_SETTINGS.cameraView, 'first');
});

test('игра от третьего лица: модель видна в мире, камера стоит позади игрока', async () => {
  const browser = createFakeBrowser();
  try {
    const { Game } = await import('../src/core/Game.ts');
    const settings = new Settings();
    settings.set('renderDistance', 2);
    settings.set('cameraView', 'third-back');
    const app = document.getElementById('app')!;
    const game = new Game(app, settings) as unknown as {
      state: string;
      player: { x: number; y: number; z: number } | null;
      playerModel: { root: { visible: boolean } } | null;
      camera: { position: { x: number; y: number; z: number } };
      startWorld(seed: string, mode: string): void;
      quitToMenu(): void;
    };
    game.startWorld('12345', 'creative');
    for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
    assert.equal(game.state, 'playing');
    await browser.frames(3);
    assert.ok(game.playerModel, 'модель создана вместе с миром');
    assert.equal(game.playerModel!.root.visible, true, 'от третьего лица модель видна');
    const p = game.player!;
    const dist = Math.hypot(game.camera.position.x - p.x, game.camera.position.z - p.z);
    assert.ok(dist > 2, `камера должна отойти от игрока, дистанция ${dist.toFixed(2)}`);

    settings.set('cameraView', 'first');
    await browser.frames(2);
    assert.equal(game.playerModel!.root.visible, false, 'от первого лица модель скрыта');
    game.quitToMenu();
    assert.equal(game.playerModel, null, 'модель освобождена вместе с миром');
  } finally { browser.close(); }
});

test('вид от третьего лица выбирается в настройках, сохраняется и переживает битое значение', () => {
  const browser = createFakeBrowser();
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ cameraView: 'задом-наперёд' }));
    const settings = new Settings();
    assert.equal(settings.get().cameraView, 'first', 'неизвестный вид отбрасывается в пользу первого лица');

    const panel = new SettingsPanel(document.getElementById('app')!, settings);
    panel.setVisible(true);
    const buttons = [...panel.root.querySelectorAll('.view-option')] as HTMLButtonElement[];
    assert.equal(buttons.length, 3, 'три варианта вида камеры');
    buttons[1].click();
    assert.equal(settings.get().cameraView, 'third-back');
    assert.ok(buttons[1].classList.contains('on'), 'выбранный вариант подсвечен');
    buttons[2].click();
    assert.equal(settings.get().cameraView, 'third-front');

    assert.equal(new Settings().get().cameraView, 'third-front', 'выбор сохранён в localStorage');
  } finally { browser.close(); }
});
