import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';
import { TouchControls } from '../src/input/TouchControls.ts';
import { InputState, type InputActions } from '../src/input/InputState.ts';
import { HOLD_TO_BREAK_MS, BREAK_REPEAT_MS } from '../src/config.ts';
import { Hud } from '../src/ui/Hud.ts';
import { Inventory } from '../src/ui/Inventory.ts';

function setup(pointer: boolean, brokenCapture = false, gestures = true) {
  const browser = createFakeBrowser();
  const win = browser.window;
  if (!pointer) Object.defineProperty(win, 'PointerEvent', { value: undefined, configurable: true });
  if (brokenCapture) {
    win.Element.prototype.setPointerCapture = () => { throw new Error('NotFoundError'); };
    win.Element.prototype.releasePointerCapture = () => { throw new Error('NotFoundError'); };
  }
  const errors: unknown[] = [];
  win.addEventListener('error', (e) => errors.push(e.error));
  const state = new InputState();
  const calls = { place: 0, break: 0, fly: 0 };
  const actions: InputActions = {
    placeBlock: () => calls.place++, breakBlock: () => calls.break++, toggleFly: () => calls.fly++,
    selectHotbar() {}, scrollHotbar() {}, togglePause() {}, toggleInventory() {},
  };
  const controls = new TouchControls(win.document.getElementById('app')!, state, actions);
  controls.configure({ touchGestures: gestures, touchButtonSize: 64 });
  controls.setEnabled(true);
  const layer = controls.root.querySelector('.touch-layer')!;
  const jump = controls.root.querySelector('.jump-btn')!;
  const sneak = controls.root.querySelector('.sneak-btn')!;
  const breakBtn = controls.root.querySelector('.break-btn')!;
  const placeBtn = controls.root.querySelector('.place-btn')!;
  const send = (target: EventTarget, phase: 'down' | 'move' | 'up' | 'cancel', id: number, x = 700, y = 300) => {
    let event: Event;
    if (pointer) {
      event = new win.PointerEvent(`pointer${phase}`, {
        pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, cancelable: true,
      });
    } else {
      event = new win.Event({ down: 'touchstart', move: 'touchmove', up: 'touchend', cancel: 'touchcancel' }[phase], {
        bubbles: true, cancelable: true,
      });
      Object.defineProperty(event, 'changedTouches', { value: [{ identifier: id, clientX: x, clientY: y }] });
    }
    target.dispatchEvent(event);
    return event;
  };
  return {
    browser, win, state, calls, controls, layer, jump, sneak, breakBtn, placeBtn, send,
    close() {
      controls.dispose();
      browser.close();
      assert.deepEqual(errors, [], 'обработчики не выбрасывают исключения');
    },
  };
}

for (const pointer of [true, false]) {
  const mode = pointer ? 'Pointer Events' : 'Android без Pointer Events';
  test(`${mode}: движение + камера + прыжок без capture, отпускание вне элемента`, () => {
    const f = setup(pointer, true);
    try {
      const { send, layer, jump, win, state, calls } = f;
      assert.equal(send(layer, 'down', 1, 120, 400).defaultPrevented, true);
      send(win, 'move', 1, 120, 280);
      assert.equal(state.moveZ, 1);
      assert.equal(state.sprint, true);
      send(layer, 'down', 2);
      send(win, 'move', 2, 760, 330);
      assert.equal(state.lookDX, 60);
      assert.equal(state.lookDY, 30);
      send(jump, 'down', 3);
      assert.equal(state.jump, true);
      send(jump, 'down', 4); // лишний палец не меняет владельца кнопки
      send(win, 'up', 4);
      assert.equal(state.jump, true);
      assert.equal(calls.fly, 0, 'первое нажатие не включает полёт');
      send(win, 'up', 3);
      assert.equal(state.jump, false);
      assert.equal(state.moveZ, 1, 'отпускание прыжка не сбрасывает джойстик');
      send(jump, 'down', 5);
      assert.equal(calls.fly, 1);
      send(win, 'up', 5);
      send(win, 'up', 2, 760, 330);
      assert.equal(calls.place, 0);
      send(win, 'up', 1, 120, 280);
      assert.equal(state.moveZ, 0);
      assert.equal(state.sprint, false);
    } finally { f.close(); }
  });

  test(`${mode}: отмена не ставит блок, обычный тап ставит ровно один`, async () => {
    const f = setup(pointer);
    try {
      f.send(f.layer, 'down', 1);
      f.send(f.win, 'cancel', 1);
      assert.equal(f.calls.place, 0);
      await new Promise((r) => setTimeout(r, HOLD_TO_BREAK_MS + 40));
      assert.equal(f.calls.break, 0, 'отменённый жест не запускает ломание');
      f.send(f.layer, 'down', 2);
      f.send(f.win, 'up', 2);
      f.send(f.win, 'up', 2);
      assert.equal(f.calls.place, 1);
      f.send(f.layer, 'down', 3);
      f.send(f.win, 'up', 3, 800); // отпускание без последнего move — не тап
      assert.equal(f.calls.place, 1);
      f.send(f.layer, 'down', 4, 100, 300);
      f.send(f.layer, 'down', 5, 110, 300);
      f.send(f.win, 'up', 5, 110, 300);
      assert.equal(f.calls.place, 1, 'второй палец в зоне движения не ставит блок');
    } finally { f.close(); }
  });

  test(`${mode}: пауза, blur и поворот экрана сбрасывают все касания`, () => {
    const f = setup(pointer);
    try {
      for (const interrupt of [
        () => f.controls.setEnabled(false),
        () => f.win.dispatchEvent(new f.win.Event('blur')),
        () => f.win.dispatchEvent(new f.win.Event('resize')),
        () => {
          Object.defineProperty(f.win.document, 'hidden', { value: true, configurable: true });
          f.win.document.dispatchEvent(new f.win.Event('visibilitychange'));
        },
      ]) {
        f.controls.setEnabled(true);
        f.controls.setFlying(true);
        f.send(f.layer, 'down', 1, 120, 400);
        f.send(f.win, 'move', 1, 120, 280);
        f.send(f.layer, 'down', 2);
        f.send(f.jump, 'down', 3);
        f.send(f.sneak, 'down', 4);
        interrupt();
        assert.deepEqual(f.state, new InputState());
        assert.equal(f.controls.root.querySelectorAll('.active').length, 0);
        f.send(f.win, 'up', 2);
        assert.equal(f.calls.place, 0);
      }
      f.controls.setEnabled(false);
      f.send(f.jump, 'down', 10);
      assert.equal(f.state.jump, false, 'скрытые кнопки не работают во время паузы');
    } finally { f.close(); }
  });

  test(`${mode}: удержание ломает, отмена останавливает повтор`, async () => {
    const f = setup(pointer);
    try {
      f.send(f.layer, 'down', 1);
      await new Promise((r) => setTimeout(r, HOLD_TO_BREAK_MS + 40));
      assert.ok(f.calls.break > 0);
      f.send(f.win, 'cancel', 1);
      const count = f.calls.break;
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.equal(f.calls.break, count);
      assert.equal(f.calls.place, 0);
    } finally { f.close(); }
  });
}

test('потеря pointer capture не оставляет нажатий и не ставит блок', () => {
  const f = setup(true);
  try {
    f.send(f.layer, 'down', 1);
    f.layer.dispatchEvent(new f.win.PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }));
    f.send(f.win, 'up', 1);
    assert.equal(f.calls.place, 0);
    f.send(f.jump, 'down', 2);
    f.jump.dispatchEvent(new f.win.PointerEvent('lostpointercapture', { pointerId: 2, bubbles: true }));
    assert.equal(f.state.jump, false);
  } finally { f.close(); }
});

test('HUD без Pointer Events: хотбар, инвентарь, пауза', () => {
  const f = setup(false);
  try {
    const hud = new Hud(f.win.document.getElementById('app')!);
    let slot = -1, inventory = 0, pause = 0;
    hud.onSelectSlot = (i) => { slot = i; };
    hud.onOpenInventory = () => { inventory++; };
    hud.onPause = () => { pause++; };
    for (const el of [hud.root.querySelectorAll('.slot')[2], hud.root.querySelector('.inv-btn')!, hud.root.querySelector('.pause-btn')!]) {
      el.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true, cancelable: true }));
    }
    assert.equal(slot, 2);
    assert.equal(inventory, 1);
    assert.equal(pause, 1);
    const panel = new Inventory(f.win.document.getElementById('app')!);
    panel.onClose = () => panel.close();
    panel.open();
    panel.root.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
    assert.equal(panel.isOpen, false, 'тап вне панели закрывает инвентарь');
  } finally { f.close(); }
});

for (const pointer of [true, false]) {
  const mode = pointer ? 'Pointer Events' : 'Touch Events';

  test(`${mode}: отдельные кнопки — обзор не меняет мир, мультитач и повтор действий`, async () => {
    const f = setup(pointer, true, false);
    try {
      f.send(f.layer, 'down', 1, 120, 400);
      f.send(f.win, 'move', 1, 120, 280);
      f.send(f.layer, 'down', 2);
      await new Promise((r) => setTimeout(r, HOLD_TO_BREAK_MS + 40));
      assert.equal(f.calls.break, 0, 'палец на обзоре не ломает блоки');
      f.send(f.win, 'up', 2);
      f.send(f.layer, 'down', 2);
      f.send(f.win, 'up', 2);
      assert.equal(f.calls.place, 0, 'тап обзора не ставит блок');

      f.send(f.layer, 'down', 2);
      f.send(f.win, 'move', 2, 760, 330);
      f.send(f.breakBtn, 'down', 3);
      assert.equal(f.calls.break, 1, 'кнопка ломает сразу');
      f.send(f.breakBtn, 'down', 4);
      f.send(f.win, 'up', 4);
      assert.equal(f.calls.break, 1, 'второй палец не дублирует действие');
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.ok(f.calls.break >= 2, 'удержание повторяет ломание');
      f.send(f.win, 'up', 3);
      assert.equal(f.state.moveZ, 1);
      assert.equal(f.state.lookDX, 60);
      assert.equal(f.state.lookDY, 30);
      const count = f.calls.break;
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.equal(f.calls.break, count, 'отпускание вне кнопки останавливает повтор');

      f.send(f.placeBtn, 'down', 5);
      assert.equal(f.calls.place, 1);
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.ok(f.calls.place >= 2, 'удержание позволяет строить');
      f.send(f.win, 'cancel', 5);
      const places = f.calls.place;
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.equal(f.calls.place, places);
    } finally { f.close(); }
  });

  test(`${mode}: прерывания и смена схемы останавливают кнопки блоков`, async () => {
    const f = setup(pointer, false, false);
    try {
      for (const interrupt of [
        () => f.controls.setEnabled(false),
        () => f.win.dispatchEvent(new f.win.Event('blur')),
        () => f.win.dispatchEvent(new f.win.Event('resize')),
        () => {
          Object.defineProperty(f.win.document, 'hidden', { value: true, configurable: true });
          f.win.document.dispatchEvent(new f.win.Event('visibilitychange'));
        },
        () => f.controls.configure({ touchGestures: true, touchButtonSize: 80 }),
      ]) {
        f.controls.configure({ touchGestures: false, touchButtonSize: 64 });
        f.controls.setEnabled(true);
        f.send(f.breakBtn, 'down', 1);
        f.send(f.placeBtn, 'down', 2);
        interrupt();
        const calls = { ...f.calls };
        await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
        assert.deepEqual(f.calls, calls, 'таймеры остановлены');
        assert.deepEqual(f.state, new InputState());
        assert.equal(f.controls.root.querySelectorAll('.active').length, 0);
      }
      assert.ok(f.breakBtn.classList.contains('hidden'));
      f.send(f.breakBtn, 'down', 9);
      assert.equal(f.breakBtn.classList.contains('active'), false, 'скрытая кнопка не работает');
      f.controls.configure({ touchGestures: false, touchButtonSize: 64 });
      f.send(f.placeBtn, 'down', 10);
      f.controls.dispose();
      const count = f.calls.place;
      await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
      assert.equal(f.calls.place, count, 'dispose очищает таймеры');
    } finally { f.close(); }
  });

  test(`${mode}: мёртвая зона джойстика и устойчивый бег`, () => {
    const f = setup(pointer, false, false);
    try {
      f.send(f.layer, 'down', 1, 120, 400);
      f.send(f.win, 'move', 1, 120, 396);
      assert.equal(f.state.moveZ, 0);
      f.send(f.win, 'move', 1, 120, 391);
      assert.ok(f.state.moveZ > 0 && f.state.moveZ < 0.03, 'плавный выход из мёртвой зоны');
      f.send(f.win, 'move', 1, 120, 280);
      assert.equal(f.state.sprint, true);
      f.send(f.win, 'move', 1, 120, 315);
      assert.equal(f.state.sprint, true, 'бег не мигает у порога');
      f.send(f.win, 'move', 1, 120, 345);
      assert.equal(f.state.sprint, false);
      f.send(f.win, 'cancel', 1);
      assert.equal(f.controls.root.classList.contains('moving'), false);
      assert.equal(f.state.moveZ, 0);
    } finally { f.close(); }
  });
}

test('потеря capture кнопки блоков останавливает повтор', async () => {
  const f = setup(true, false, false);
  try {
    f.send(f.breakBtn, 'down', 1);
    f.breakBtn.dispatchEvent(new f.win.PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }));
    const count = f.calls.break;
    await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
    assert.equal(f.calls.break, count);
    assert.equal(f.breakBtn.classList.contains('active'), false);
  } finally { f.close(); }
});

test('изменение visualViewport сбрасывает все касания', async () => {
  const browser = createFakeBrowser();
  const viewport = new browser.window.EventTarget();
  Object.defineProperty(browser.window, 'visualViewport', { value: viewport });
  const state = new InputState();
  let breaks = 0;
  const controls = new TouchControls(browser.window.document.getElementById('app')!, state, {
    breakBlock() { breaks++; }, placeBlock() {}, toggleFly() {}, selectHotbar() {},
    scrollHotbar() {}, togglePause() {}, toggleInventory() {},
  });
  try {
    controls.setEnabled(true);
    const button = controls.root.querySelector('.break-btn')!;
    button.dispatchEvent(new browser.window.PointerEvent('pointerdown', { pointerId: 1, bubbles: true }));
    assert.equal(breaks, 1);
    viewport.dispatchEvent(new browser.window.Event('resize'));
    await new Promise((r) => setTimeout(r, BREAK_REPEAT_MS + 40));
    assert.equal(breaks, 1);
    assert.equal(button.classList.contains('active'), false);
  } finally { controls.dispose(); browser.close(); }
});
