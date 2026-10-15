import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import { PlayerModel, cameraPoseForView } from '../src/render/PlayerModel.ts';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, THIRD_PERSON_DISTANCE } from '../src/config.ts';
import { Settings } from '../src/core/Settings.ts';
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
  assert.ok(kneeL.rotation.x + kneeR.rotation.x > 0, 'колено слегка сгибается в шаге');
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

test('в руке модели — выбранный блок с текстурами, пустая рука без блока', async () => {
  const { GRASS, AIR } = await import('../src/world/Blocks.ts');
  const model = new PlayerModel();
  const held = model.root.getObjectByName('held-item') as Mesh;
  assert.ok(held, 'место предмета в руке есть');
  assert.equal(held.visible, false, 'сначала рука пуста');
  model.setHeldBlock(GRASS);
  assert.equal(held.visible, true, 'блок появился в руке');
  assert.ok(Array.isArray(held.material) && held.material.length === 6, 'у мини-куба шесть граней с текстурами');
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
