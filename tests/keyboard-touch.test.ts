import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';
import { InputState } from '../src/input/InputState.ts';
import { KeyboardMouse } from '../src/input/KeyboardMouse.ts';

test('событие мыши от касания не захватывает курсор и не ломает блок; обычная мышь работает', () => {
  const browser = createFakeBrowser();
  try {
    const win = browser.window;
    const surface = win.document.getElementById('app')!;
    const canvas = win.document.createElement('canvas');
    surface.append(canvas);
    let locks = 0, breaks = 0;
    canvas.requestPointerLock = () => { locks++; return Promise.resolve(); };
    const keyboard = new KeyboardMouse(canvas, surface, new InputState(), {
      breakBlock() { breaks++; }, placeBlock() {}, toggleFly() {}, selectHotbar() {},
      scrollHotbar() {}, togglePause() {}, toggleInventory() {},
    });
    keyboard.setEnabled(true);
    const mouse = (fromTouch: boolean) => {
      const event = new win.MouseEvent('mousedown', { bubbles: true, button: 0 });
      Object.defineProperty(event, 'sourceCapabilities', { value: { firesTouchEvents: fromTouch } });
      canvas.dispatchEvent(event);
    };
    mouse(true);
    assert.equal(locks, 0);
    mouse(false);
    assert.equal(locks, 1);
    Object.defineProperty(win.document, 'pointerLockElement', { value: canvas });
    mouse(true);
    assert.equal(breaks, 0);
    mouse(false);
    assert.equal(breaks, 1);
    keyboard.setEnabled(false);
  } finally { browser.close(); }
});
