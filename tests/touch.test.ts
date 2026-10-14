import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';

// Сенсорный путь по умолчанию: джойстик, безопасный обзор, отдельные кнопки блоков и прыжка/полёта.
test('сенсорное управление: джойстик, камера, кнопки блоков, прыжок и полёт', async () => {
  const browser = createFakeBrowser();
  const { window: win } = browser;
  // Делаем устройство «сенсорным» до загрузки модулей игры
  Object.defineProperty(win, 'ontouchstart', { value: null, configurable: true });
  const errors: unknown[] = [];
  win.addEventListener('error', (e) => errors.push((e as ErrorEvent).error ?? e));

  try {
    const { Game } = await import('../src/core/Game.ts');
    const { Settings } = await import('../src/core/Settings.ts');
    const { IS_TOUCH_DEVICE } = await import('../src/config.ts');
    const { AIR, BLOCK_REPLACEABLE } = await import('../src/world/Blocks.ts');
    assert.equal(IS_TOUCH_DEVICE, true);

    const settings = new Settings();
    settings.set('renderDistance', 2);
    let lockRequests = 0;
    win.HTMLCanvasElement.prototype.requestPointerLock = () => { lockRequests++; return Promise.resolve(); };
    const app = win.document.getElementById('app')!;
    const game = new Game(app, settings) as unknown as {
      state: string;
      world: { getBlock(x: number, y: number, z: number): number } | null;
      player: { x: number; y: number; z: number; yaw: number; pitch: number; flying: boolean } | null;
      currentHit: { x: number; y: number; z: number; nx: number; ny: number; nz: number; id: number } | null;
      hotbar: number[];
      selectedSlot: number;
      input: { moveZ: number; jump: boolean };
      startWorld(seed: string): void;
      pause(): void;
      resume(): void;
      openInventory(): void;
      closeInventory(): void;
    };
    game.startWorld('7');
    for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
    assert.equal(game.state, 'playing');
    assert.equal(lockRequests, 0, 'на сенсорном устройстве запуск не захватывает мышь');

    const controls = win.document.querySelector('.touch-controls')!;
    assert.ok(!controls.classList.contains('hidden'), 'сенсорные элементы видны на тач-устройстве');
    const layer = win.document.querySelector('.touch-layer')!;
    const pe = (type: string, id: number, x: number, y: number) =>
      layer.dispatchEvent(new win.PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true }));

    const p = game.player!;

    // --- Джойстик: палец слева, движение вверх = вперёд ---
    const x0 = p.x, z0 = p.z;
    pe('pointerdown', 1, 120, 400);
    assert.ok(!win.document.querySelector('.joy-base')!.classList.contains('hidden'), 'джойстик появился');
    pe('pointermove', 1, 120, 330);
    assert.ok(game.input.moveZ > 0.9, `moveZ=${game.input.moveZ}`);
    await browser.frames(45);
    pe('pointerup', 1, 120, 330);
    assert.equal(game.input.moveZ, 0);
    assert.ok(win.document.querySelector('.joy-base')!.classList.contains('hidden'), 'джойстик скрылся');
    assert.ok(Math.hypot(p.x - x0, p.z - z0) > 0.8, 'игрок прошёл вперёд по джойстику');

    // --- Свайп справа поворачивает камеру и не ставит блок ---
    const yaw0 = p.yaw;
    pe('pointerdown', 2, 700, 300);
    pe('pointermove', 2, 760, 300);
    pe('pointermove', 2, 820, 300);
    await browser.frames(2);
    pe('pointerup', 2, 820, 300);
    assert.ok(Math.abs(p.yaw - yaw0) > 0.1, `камера повернулась (dyaw=${p.yaw - yaw0})`);

    // --- Блоки ставятся только отдельной кнопкой, не касанием зоны обзора ---
    p.pitch = -0.8;
    await browser.frames(2);
    const hit = game.currentHit!;
    assert.ok(hit, 'есть цель для установки');
    const target = BLOCK_REPLACEABLE[hit.id] === 1
      ? { x: hit.x, y: hit.y, z: hit.z }
      : { x: hit.x + hit.nx, y: hit.y + hit.ny, z: hit.z + hit.nz };
    pe('pointerdown', 3, 700, 300);
    pe('pointerup', 3, 700, 300);
    assert.notEqual(game.world!.getBlock(target.x, target.y, target.z), game.hotbar[game.selectedSlot], 'тап обзора не ставит блок');
    const actionButton = (selector: string, type: string, id: number) =>
      win.document.querySelector(selector)!.dispatchEvent(new win.PointerEvent(type, {
        pointerId: id, pointerType: 'touch', bubbles: true,
      }));
    actionButton('.place-btn', 'pointerdown', 3);
    actionButton('.place-btn', 'pointerup', 3);
    assert.equal(game.world!.getBlock(target.x, target.y, target.z), game.hotbar[game.selectedSlot], 'кнопка поставила блок');

    // --- Удержание ломает блок ---
    await browser.frames(2);
    const hit2 = game.currentHit!;
    assert.ok(hit2);
    actionButton('.break-btn', 'pointerdown', 4);
    actionButton('.break-btn', 'pointerup', 4);
    assert.equal(game.world!.getBlock(hit2.x, hit2.y, hit2.z), AIR, 'кнопка сломала блок');

    // --- Кнопка прыжка и полёт двойным нажатием ---
    const jump = win.document.querySelector('.jump-btn')!;
    const btn = (type: string, el: Element) =>
      el.dispatchEvent(new win.PointerEvent(type, { pointerId: 9, pointerType: 'touch', bubbles: true }));
    btn('pointerdown', jump);
    assert.equal(game.input.jump, true);
    btn('pointerup', jump);
    assert.equal(game.input.jump, false);
    btn('pointerdown', jump);
    btn('pointerup', jump);
    assert.equal(p.flying, true, 'двойное нажатие прыжка включает полёт');
    assert.ok(!win.document.querySelector('.sneak-btn')!.classList.contains('hidden'), 'в полёте есть кнопка снижения');

    game.pause();
    game.resume();
    game.openInventory();
    game.closeInventory();
    assert.equal(lockRequests, 0, 'возврат из паузы и инвентаря не захватывает мышь');
    assert.deepEqual(errors, []);
  } finally {
    browser.close();
  }
});
