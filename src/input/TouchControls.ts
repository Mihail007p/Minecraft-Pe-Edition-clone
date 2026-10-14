import { BREAK_REPEAT_MS, DEFAULT_SETTINGS, DOUBLE_TAP_MS, HOLD_TO_BREAK_MS, TAP_MAX_MOVE_PX, type GameSettings } from '../config.ts';
import type { InputActions, InputState } from './InputState.ts';
import { bindTouchContacts, type TouchContact } from './TouchContacts.ts';

const JOY_RADIUS = 56; // px — максимальное отклонение ручки
const JOY_ZONE = 0.42; // доля ширины экрана слева, где палец управляет движением

/**
 * Сенсорное управление в духе Pocket Edition:
 *  - левая часть экрана: плавающий джойстик движения;
 *  - правая часть: только обзор; отдельные кнопки для блоков под прицелом;
 *  - тап/удержание можно включить в настройках вместо кнопок;
 *  - кнопка прыжка (двойное нажатие — полёт), в полёте появляется кнопка снижения.
 */
export class TouchControls {
  readonly root: HTMLElement;
  private layer: HTMLElement;
  private joyBase: HTMLElement;
  private joyKnob: HTMLElement;
  private jumpBtn: HTMLElement;
  private sneakBtn: HTMLElement;
  private state: InputState;
  private actions: InputActions;

  private movePointer: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private lookPointer: number | null = null;
  private lookLast = { x: 0, y: 0 };
  private lookStart = { x: 0, y: 0, t: 0 };
  private lookMoved = 0;
  private holdTimer: number | null = null;
  private breakTimer: number | null = null;
  private breaking = false;
  private lastJumpTap = -Infinity;
  private bindings: ReturnType<typeof bindTouchContacts>[] = [];
  private buttonResets: (() => void)[] = [];
  private enabled = false;
  private gestures = DEFAULT_SETTINGS.touchGestures;
  private buttonSize = DEFAULT_SETTINGS.touchButtonSize;

  constructor(parent: HTMLElement, state: InputState, actions: InputActions) {
    this.state = state;
    this.actions = actions;

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-layer"></div>
      <div class="joy-home" aria-hidden="true"><span>↕</span><span>Движение</span></div>
      <div class="joy-base hidden"><div class="joy-knob"></div></div>
      <div class="touch-actions">
        <button type="button" class="touch-btn break-btn" aria-label="Сломать блок">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26"><path fill="currentColor" d="m4 3 2-2 15 6-1 5-3-4-4-1-8 14-3-2 8-14z"/></svg><span>Сломать</span>
        </button>
        <button type="button" class="touch-btn place-btn" aria-label="Поставить блок">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="26" height="26"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="m12 2 9 5v10l-9 5-9-5V7zM3 7l9 5 9-5M12 12v10"/></svg><span>Поставить</span>
        </button>
        <button type="button" class="touch-btn jump-btn" aria-label="Прыжок; двойное нажатие — полёт">
          <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 3 4 11h5v10h6V11h5z"/></svg>
        </button>
        <button type="button" class="touch-btn sneak-btn hidden" aria-label="Вниз">
          <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 21l8-8h-5V3H9v10H4z"/></svg>
        </button>
      </div>
    `;
    parent.appendChild(this.root);
    this.layer = this.root.querySelector('.touch-layer')!;
    this.joyBase = this.root.querySelector('.joy-base')!;
    this.joyKnob = this.root.querySelector('.joy-knob')!;
    this.jumpBtn = this.root.querySelector('.jump-btn')!;
    this.sneakBtn = this.root.querySelector('.sneak-btn')!;

    this.bindings.push(bindTouchContacts(this.layer, {
      down: this.onDown,
      move: this.onMove,
      up: this.onUp,
    }));
    window.addEventListener('blur', this.releaseAll);
    window.addEventListener('resize', this.releaseAll);
    window.visualViewport?.addEventListener('resize', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibilityChange);

    this.bindRepeatButton(this.root.querySelector('.break-btn')!, () => this.actions.breakBlock());
    this.bindRepeatButton(this.root.querySelector('.place-btn')!, () => this.actions.placeBlock());
    this.configure(DEFAULT_SETTINGS);

    this.bindButton(this.jumpBtn, (down) => {
      this.state.jump = down;
      if (down) {
        const now = performance.now();
        if (now - this.lastJumpTap < DOUBLE_TAP_MS) {
          this.actions.toggleFly();
          this.lastJumpTap = -Infinity;
        } else {
          this.lastJumpTap = now;
        }
      }
    });
    this.bindButton(this.sneakBtn, (down) => {
      this.state.sneak = down;
    });
  }

  /** Смена схемы/размера не оставляет активных пальцев и таймеров. */
  configure(settings: Pick<GameSettings, 'touchGestures' | 'touchButtonSize'>): void {
    const size = Number.isFinite(settings.touchButtonSize)
      ? Math.max(56, Math.min(80, settings.touchButtonSize)) : DEFAULT_SETTINGS.touchButtonSize;
    if (this.gestures !== settings.touchGestures || this.buttonSize !== size) this.releaseAll();
    this.gestures = settings.touchGestures;
    this.buttonSize = size;
    this.root.style.setProperty('--touch-button-size', `${size}px`);
    for (const button of this.root.querySelectorAll('.break-btn, .place-btn')) {
      button.classList.toggle('hidden', this.gestures);
    }
  }

  private bindRepeatButton(el: HTMLElement, action: () => void): void {
    let timer: number | null = null;
    this.bindButton(el, (down) => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
      if (down) {
        timer = window.setInterval(action, BREAK_REPEAT_MS);
        action();
      }
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.root.classList.toggle('hidden', !enabled);
    if (!enabled) this.releaseAll();
  }

  /** Показать кнопку снижения, когда игрок летит. */
  setFlying(flying: boolean): void {
    this.sneakBtn.classList.toggle('hidden', !flying);
    if (!flying) this.state.sneak = false;
  }

  private bindButton(el: HTMLElement, handler: (down: boolean) => void): void {
    let pointer: number | null = null;
    const reset = () => {
      pointer = null;
      el.classList.remove('active');
      handler(false);
    };
    this.buttonResets.push(reset);
    this.bindings.push(bindTouchContacts(el, {
      down: (e) => {
        if (!this.enabled || el.classList.contains('hidden') || pointer !== null) return false;
        pointer = e.pointerId;
        el.classList.add('active');
        handler(true);
        return true;
      },
      move: () => undefined,
      up: (e, cancelled) => {
        if (e.pointerId !== pointer) return;
        if (cancelled) this.lastJumpTap = -Infinity;
        reset();
      },
    }));
  }

  private onDown = (e: TouchContact): boolean => {
    if (!this.enabled) return false;
    const width = window.innerWidth;
    if (this.movePointer === null && e.clientX < width * JOY_ZONE) {
      this.movePointer = e.pointerId;
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.classList.remove('hidden');
      this.root.classList.add('moving');
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      return true;
    }
    // Второй палец слева не должен случайно ставить/ломать блоки.
    if (e.clientX >= width * JOY_ZONE && this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.lookMoved = 0;
      this.breaking = false;
      this.clearTimers();
      if (!this.gestures) return true;
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        if (this.lookPointer === null || this.lookMoved > TAP_MAX_MOVE_PX) return;
        this.breaking = true;
        this.actions.breakBlock();
        this.breakTimer = window.setInterval(() => this.actions.breakBlock(), BREAK_REPEAT_MS);
      }, HOLD_TO_BREAK_MS);
      return true;
    }
    return false;
  };

  private onMove = (e: TouchContact): void => {
    if (!this.enabled) return;
    if (e.pointerId === this.movePointer) {
      let dx = e.clientX - this.moveOrigin.x;
      let dy = e.clientY - this.moveOrigin.y;
      const dist = Math.hypot(dx, dy);
      const rawDist = dist;
      if (dist > JOY_RADIUS) {
        dx = (dx / dist) * JOY_RADIUS;
        dy = (dy / dist) * JOY_RADIUS;
      }
      this.joyKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
      let mx = dx / JOY_RADIUS;
      let mz = -dy / JOY_RADIUS;
      const mag = Math.hypot(mx, mz);
      // Плавный выход из мёртвой зоны вместо скачка скорости от дрожания пальца.
      const strength = Math.max(0, (mag - 0.15) / 0.85);
      if (mag > 0) { mx = mx / mag * strength; mz = mz / mag * strength; }
      this.state.moveX = mx;
      this.state.moveZ = mz;
      // Бег: палец уведён далеко за пределы джойстика вперёд
      this.state.sprint = rawDist > JOY_RADIUS * (this.state.sprint ? 1.3 : 1.6) && mz > 0.5;
      return;
    }
    if (e.pointerId === this.lookPointer) {
      const dx = e.clientX - this.lookLast.x;
      const dy = e.clientY - this.lookLast.y;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookMoved = Math.max(this.lookMoved, Math.hypot(e.clientX - this.lookStart.x, e.clientY - this.lookStart.y));
      this.state.lookDX += dx;
      this.state.lookDY += dy;
      // Палец поехал до начала ломания — это свайп камеры, а не удержание.
      if (!this.breaking && this.lookMoved > TAP_MAX_MOVE_PX && this.holdTimer !== null) {
        window.clearTimeout(this.holdTimer);
        this.holdTimer = null;
      }
    }
  };

  private onUp = (e: TouchContact, cancelled: boolean): void => {
    if (e.pointerId === this.movePointer) {
      this.movePointer = null;
      this.state.moveX = 0;
      this.state.moveZ = 0;
      this.state.sprint = false;
      this.joyBase.classList.add('hidden');
      this.root.classList.remove('moving');
      return;
    }
    if (e.pointerId === this.lookPointer) {
      this.lookMoved = Math.max(this.lookMoved, Math.hypot(e.clientX - this.lookStart.x, e.clientY - this.lookStart.y));
      const held = performance.now() - this.lookStart.t;
      const wasBreaking = this.breaking;
      this.clearTimers();
      this.lookPointer = null;
      if (this.gestures && !cancelled && !wasBreaking && held < HOLD_TO_BREAK_MS + 80 && this.lookMoved <= TAP_MAX_MOVE_PX && this.enabled) {
        this.actions.placeBlock();
      }
    }
  };

  private clearTimers(): void {
    if (this.holdTimer !== null) { window.clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.breakTimer !== null) { window.clearInterval(this.breakTimer); this.breakTimer = null; }
    this.breaking = false;
  }

  private onVisibilityChange = (): void => {
    if (document.hidden) this.releaseAll();
  };

  private releaseAll = (): void => {
    this.clearTimers();
    this.bindings.forEach((binding) => binding.reset());
    this.buttonResets.forEach((reset) => reset());
    this.lastJumpTap = -Infinity;
    this.movePointer = null;
    this.lookPointer = null;
    this.joyBase.classList.add('hidden');
    this.root.classList.remove('moving');
    this.state.reset();
  };

  dispose(): void {
    this.releaseAll();
    this.bindings.forEach((binding) => binding.dispose());
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('resize', this.releaseAll);
    window.visualViewport?.removeEventListener('resize', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.root.remove();
  }
}
