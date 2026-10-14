import './style.css';
import { Game } from './core/Game.ts';
import { Settings } from './core/Settings.ts';

const app = document.getElementById('app');
if (!app) throw new Error('Не найден контейнер #app');

const settings = new Settings();
const game = new Game(app, settings);

// Для отладки из консоли браузера
(window as unknown as { game: Game }).game = game;

// PWA: service worker только в продакшен-сборке, чтобы не кэшировать dev-ресурсы
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}
