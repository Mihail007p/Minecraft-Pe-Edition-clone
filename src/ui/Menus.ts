import type { GameMode } from '../player/Survival.ts';
import {
  GAME_TITLE, GAME_VERSION, type CameraView, type GameSettings,
} from '../config.ts';
import type { Settings } from '../core/Settings.ts';
import { button, el, show } from './dom.ts';

/** Главное меню. */
export class MainMenu {
  readonly root: HTMLElement;
  onPlay: ((seed: string, mode: GameMode) => void) | null = null;
  onSettings: (() => void) | null = null;
  private seedInput: HTMLInputElement;

  constructor(parent: HTMLElement) {
    this.seedInput = el('input', {
      class: 'mc-input', type: 'text', placeholder: 'Сид мира (необязательно)',
      autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    });
    const mode = el('select', { class: 'mc-input mode-select', 'aria-label': 'Режим игры' }, [
      el('option', { value: 'survival' }, ['Выживание — здоровье, голод и добыча']),
      el('option', { value: 'creative' }, ['Творческий — полёт и все блоки']),
    ]);
    this.root = el('div', { class: 'overlay main-menu' }, [
      el('div', { class: 'menu-box' }, [
        el('h1', { class: 'title' }, [GAME_TITLE]),
        el('div', { class: 'subtitle' }, ['Веб-версия в духе Pocket Edition']),
        this.seedInput,
        mode,
        button('Играть', () => this.onPlay?.(this.seedInput.value.trim(), mode.value as GameMode), 'primary big'),
        button('Настройки', () => this.onSettings?.(), 'big'),
        el('div', { class: 'version' }, [`v${GAME_VERSION} · животные и выживание`]),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }
}

/** Меню паузы. */
export class PauseMenu {
  readonly root: HTMLElement;
  onResume: (() => void) | null = null;
  onSettings: (() => void) | null = null;
  onQuit: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div', { class: 'overlay pause-menu hidden' }, [
      el('div', { class: 'menu-box' }, [
        el('h2', { class: 'title small' }, ['Пауза']),
        button('Продолжить', () => this.onResume?.(), 'primary big'),
        button('Настройки', () => this.onSettings?.(), 'big'),
        button('Выйти в главное меню', () => this.onQuit?.(), 'big'),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }
}

/** Панель настроек с ползунками и переключателями; изменения применяются сразу. */
export class SettingsPanel {
  readonly root: HTMLElement;
  onBack: (() => void) | null = null;
  private settings: Settings;
  private controls = new Map<keyof GameSettings, () => void>();

  constructor(parent: HTMLElement, settings: Settings) {
    this.settings = settings;
    const list = el('div', { class: 'settings-list' });
    list.append(
      this.cameraViewControl(),
      el('p', { class: 'control-help' }, ['От третьего лица видна детальная модель игрока: лицо и причёска, куртка с рюкзаком, ботинки со шнурками, анимации ходьбы, плавания и взмаха рукой. Камера сама укорачивает дистанцию у стен. На ПК вид переключается клавишей V, на телефоне — кнопкой камеры в игре.']),
      this.slider('renderDistance', 'Дальность прорисовки', 3, 10, 1, (v) => `${v} чанков`),
      this.slider('fov', 'Поле зрения', 50, 110, 1, (v) => `${v}°`),
      this.slider('sensitivity', 'Чувствительность', 0.3, 3, 0.1, (v) => `${Math.round(v * 100)}%`),
      this.slider('touchButtonSize', 'Размер сенсорных кнопок', 56, 80, 4, (v) => `${v} px`),
      this.toggle('touchGestures', 'Тап / удержание для блоков'),
      el('p', { class: 'control-help' }, ['Слева — движение, справа — обзор. Кнопки «Сломать» и «Поставить» работают по прицелу; удерживайте для повтора. Двойной прыжок — полёт только в творческом режиме. Включите тап / удержание, чтобы вернуть управление блоками жестами.']),
      this.toggle('autoJump', 'Автопрыжок'),
      this.toggle('invertY', 'Инвертировать ось Y'),
      this.toggle('showCoords', 'Показывать координаты и FPS'),
    );
    this.root = el('div', { class: 'overlay settings hidden' }, [
      el('div', { class: 'menu-box wide' }, [
        el('h2', { class: 'title small' }, ['Настройки']),
        list,
        el('div', { class: 'row' }, [
          button('Сбросить', () => { settings.reset(); this.refresh(); }),
          button('Готово', () => this.onBack?.(), 'primary'),
        ]),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    if (visible) this.refresh();
    show(this.root, visible);
  }

  private refresh(): void {
    for (const update of this.controls.values()) update();
  }

  /** Трёхпозиционный выбор вида камеры: первое лицо / третье сзади / третье спереди. */
  private cameraViewControl(): HTMLElement {
    const options: { value: CameraView; label: string }[] = [
      { value: 'first', label: '1-е лицо' },
      { value: 'third-back', label: '3-е сзади' },
      { value: 'third-front', label: '3-е спереди' },
    ];
    const buttons = new Map<CameraView, HTMLButtonElement>();
    const update = () => {
      const current = this.settings.get().cameraView;
      for (const [value, btn] of buttons) btn.classList.toggle('on', value === current);
    };
    const row = el('div', { class: 'view-options' });
    for (const option of options) {
      const btn = el('button', {
        class: 'mc-btn toggle view-option', type: 'button',
        click: () => { this.settings.set('cameraView', option.value); update(); },
      }, [option.label]);
      buttons.set(option.value, btn);
      row.appendChild(btn);
    }
    this.controls.set('cameraView', update);
    update();
    return el('div', { class: 'setting' }, [
      el('div', { class: 'setting-label' }, [el('span', {}, ['Вид камеры'])]),
      row,
    ]);
  }

  private slider(
    key: 'renderDistance' | 'fov' | 'sensitivity' | 'touchButtonSize', label: string,
    min: number, max: number, step: number, format: (v: number) => string,
  ): HTMLElement {
    const valueEl = el('span', { class: 'setting-value' });
    const input = el('input', { class: 'mc-slider', type: 'range', min: String(min), max: String(max), step: String(step) });
    const update = () => {
      const v = this.settings.get()[key];
      input.value = String(v);
      valueEl.textContent = format(v);
    };
    input.addEventListener('input', () => {
      const v = Number(input.value);
      valueEl.textContent = format(v);
      this.settings.set(key, v);
    });
    this.controls.set(key, update);
    update();
    return el('label', { class: 'setting' }, [
      el('div', { class: 'setting-label' }, [el('span', {}, [label]), valueEl]),
      input,
    ]);
  }

  private toggle(key: 'autoJump' | 'invertY' | 'showCoords' | 'touchGestures', label: string): HTMLElement {
    const btn = el('button', { class: 'mc-btn toggle', type: 'button' });
    const update = () => {
      const v = this.settings.get()[key];
      btn.textContent = v ? 'Вкл' : 'Выкл';
      btn.classList.toggle('on', v);
    };
    btn.addEventListener('click', () => {
      this.settings.set(key, !this.settings.get()[key]);
      update();
    });
    this.controls.set(key, update);
    update();
    return el('div', { class: 'setting row-setting' }, [el('span', {}, [label]), btn]);
  }
}

/** Экран загрузки мира. */
export class LoadingScreen {
  readonly root: HTMLElement;
  private bar: HTMLElement;
  private text: HTMLElement;

  constructor(parent: HTMLElement) {
    this.bar = el('div', { class: 'progress-fill' });
    this.text = el('div', { class: 'loading-text' }, ['Генерация мира…']);
    this.root = el('div', { class: 'overlay loading hidden' }, [
      el('div', { class: 'menu-box' }, [
        el('h2', { class: 'title small' }, ['Загрузка мира']),
        this.text,
        el('div', { class: 'progress' }, [this.bar]),
      ]),
    ]);
    parent.appendChild(this.root);
  }

  setVisible(visible: boolean): void {
    show(this.root, visible);
  }

  setProgress(fraction: number, text?: string): void {
    this.bar.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    if (text) this.text.textContent = text;
  }
}
