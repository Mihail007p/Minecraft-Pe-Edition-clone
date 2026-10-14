import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';

// Дымовой тест полного цикла игры в эмуляции браузера.
// Браузерные глобали должны существовать до импорта модулей игры → динамический import.
test('полный цикл: меню → загрузка → игра → взаимодействие → пауза → выход', async () => {
  const browser = createFakeBrowser();
  const { window: win } = browser;
  const errors: unknown[] = [];
  win.addEventListener('error', (e) => errors.push((e as ErrorEvent).error ?? e));
  process.on('unhandledRejection', (r) => errors.push(r));

  try {
  const { Game } = await import('../src/core/Game.ts');
  const { Settings } = await import('../src/core/Settings.ts');
  const { WATER, AIR } = await import('../src/world/Blocks.ts');

  const settings = new Settings();
  settings.set('renderDistance', 2);
  const app = win.document.getElementById('app')!;
  const game = new Game(app, settings) as unknown as {
    state: string;
    world: { getBlock(x: number, y: number, z: number): number } | null;
    player: { x: number; y: number; z: number; flying: boolean; pitch: number; yaw: number } | null;
    currentHit: { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null;
    chunkRenderer: { stats: { meshed: number; triangles: number } } | null;
    hotbar: number[];
    selectedSlot: number;
    startWorld(seed: string): void;
    pause(): void;
    resume(): void;
    quitToMenu(): void;
  };

  assert.equal(game.state, 'menu');
  assert.ok(win.document.querySelector('.main-menu'), 'главное меню в DOM');
  assert.ok(win.document.querySelector('.game-canvas'), 'канвас создан');

  // Нажимаем «Играть»
  const playBtn = [...win.document.querySelectorAll('button')].find((b) => b.textContent === 'Играть')!;
  (win.document.querySelector('.mc-input') as HTMLInputElement).value = '12345';
  playBtn.click();
  assert.equal(game.state, 'loading');

  for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
  assert.equal(game.state, 'playing', 'загрузка должна завершиться');
  assert.ok(game.chunkRenderer!.stats.meshed > 0);
  assert.ok((browser.glCalls.get('drawElements') ?? 0) > 0, 'были вызовы отрисовки');
  assert.ok(!win.document.querySelector('.hud')!.classList.contains('hidden'), 'HUD виден');
  const p = game.player!;
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));

  // Движение вперёд клавиатурой
  const x0 = p.x, z0 = p.z;
  browser.key('KeyW', true);
  await browser.frames(60);
  browser.key('KeyW', false);
  const moved = Math.hypot(p.x - x0, p.z - z0);
  assert.ok(moved > 1, `игрок должен сдвинуться (прошёл ${moved.toFixed(2)})`);

  // Смотрим вниз и ломаем блок под ногами (через захваченный курсор)
  Object.defineProperty(win.document, 'pointerLockElement', { get: () => win.document.querySelector('.game-canvas'), configurable: true });
  p.pitch = -1.5;
  await browser.frames(2);
  assert.ok(game.currentHit, 'под ногами должен быть блок');
  const hit = game.currentHit!;
  const before = game.world!.getBlock(hit.x, hit.y, hit.z);
  assert.notEqual(before, AIR);
  app.dispatchEvent(new win.MouseEvent('mousedown', { button: 0, bubbles: true }));
  win.dispatchEvent(new win.MouseEvent('mouseup', { button: 0, bubbles: true }));
  assert.equal(game.world!.getBlock(hit.x, hit.y, hit.z), AIR, 'блок должен сломаться');
  await browser.frames(3);

  // Ставим блок перед собой (правая кнопка): смотрим вниз-вперёд, чтобы цель не пересекалась с игроком
  p.pitch = -0.8;
  await browser.frames(2);
  const hit2 = game.currentHit!;
  assert.ok(hit2, 'перед игроком должен быть блок');
  const placedId = game.hotbar[game.selectedSlot];
  const { BLOCK_REPLACEABLE } = await import('../src/world/Blocks.ts');
  const target = BLOCK_REPLACEABLE[hit2.id] === 1
    ? { x: hit2.x, y: hit2.y, z: hit2.z }
    : { x: hit2.x + hit2.nx, y: hit2.y + hit2.ny, z: hit2.z + hit2.nz };
  app.dispatchEvent(new win.MouseEvent('mousedown', { button: 2, bubbles: true }));
  win.dispatchEvent(new win.MouseEvent('mouseup', { button: 2, bubbles: true }));
  assert.equal(game.world!.getBlock(target.x, target.y, target.z), placedId, 'блок должен появиться у цели');

  // Хотбар, инвентарь
  browser.key('Digit3', true); browser.key('Digit3', false);
  assert.equal(game.selectedSlot, 2);
  browser.key('KeyE', true); browser.key('KeyE', false);
  assert.ok(!win.document.querySelector('.inventory')!.classList.contains('hidden'), 'инвентарь открыт');
  const cells = win.document.querySelectorAll('.inv-cell');
  assert.ok(cells.length > 20, `в инвентаре ${cells.length} блоков`);
  (cells[5] as HTMLButtonElement).click();
  assert.ok(win.document.querySelector('.inventory')!.classList.contains('hidden'), 'инвентарь закрылся после выбора');

  // Полёт
  browser.key('KeyF', true); browser.key('KeyF', false);
  assert.equal(p.flying, true);
  const y0 = p.y;
  browser.key('Space', true);
  await browser.frames(40);
  browser.key('Space', false);
  assert.ok(p.y > y0 + 1, 'в полёте поднимаемся');

  // Пауза и возврат
  game.pause();
  assert.equal(game.state, 'paused');
  assert.ok(!win.document.querySelector('.pause-menu')!.classList.contains('hidden'));
  game.resume();
  assert.equal(game.state, 'playing');
  await browser.frames(5);

  // Выход в меню и повторный старт — ресурсы освобождаются без ошибок
  game.quitToMenu();
  assert.equal(game.state, 'menu');
  assert.equal(game.world, null);
  game.startWorld('другой сид');
  for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
  assert.equal(game.state, 'playing');
  assert.ok(WATER > 0);

  assert.deepEqual(errors, [], `ошибки во время выполнения: ${errors.map(String).join('; ')}`);
  } finally {
    browser.close();
  }
});
