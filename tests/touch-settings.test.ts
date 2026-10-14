import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';
import { Settings } from '../src/core/Settings.ts';
import { SettingsPanel } from '../src/ui/Menus.ts';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '../src/config.ts';

test('старые настройки получают безопасную схему кнопок; новая схема и размер сохраняются', () => {
  const browser = createFakeBrowser();
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ sensitivity: 1.5 }));
    const settings = new Settings();
    assert.equal(settings.get().touchGestures, false);
    assert.equal(settings.get().touchButtonSize, 64);
    assert.equal(settings.get().sensitivity, 1.5);
    settings.set('touchGestures', true);
    settings.set('touchButtonSize', 80);
    const reloaded = new Settings();
    assert.equal(reloaded.get().touchGestures, true);
    assert.equal(reloaded.get().touchButtonSize, 80);
    reloaded.reset();
    assert.deepEqual(new Settings().get(), DEFAULT_SETTINGS);
  } finally { browser.close(); }
});

test('настройки: переключение схемы, размер кнопок и сброс через UI', () => {
  const browser = createFakeBrowser();
  try {
    const settings = new Settings();
    const panel = new SettingsPanel(document.getElementById('app')!, settings);
    panel.setVisible(true);
    const row = [...panel.root.querySelectorAll('.row-setting')].find(el => el.textContent?.includes('Тап / удержание'))!;
    const toggle = row.querySelector('button')!;
    toggle.click();
    assert.equal(settings.get().touchGestures, true);
    assert.equal(toggle.textContent, 'Вкл');
    const label = [...panel.root.querySelectorAll('label')].find(el => el.textContent?.includes('Размер сенсорных кнопок'))!;
    const slider = label.querySelector('input')!;
    slider.value = '80';
    slider.dispatchEvent(new browser.window.Event('input', { bubbles: true }));
    assert.equal(settings.get().touchButtonSize, 80);
    [...panel.root.querySelectorAll('button')].find(el => el.textContent === 'Сбросить')!.click();
    assert.equal(slider.value, '64');
    assert.equal(toggle.textContent, 'Выкл');
    assert.deepEqual(settings.get(), DEFAULT_SETTINGS);
  } finally { browser.close(); }
});
