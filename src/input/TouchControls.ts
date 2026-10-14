import { BREAK_REPEAT_MS, DOUBLE_TAP_MS, HOLD_TO_BREAK_MS, TAP_MAX_MOVE_PX } from '../config.ts';
import type { InputActions, InputState } from './InputState.ts';

const JOY_RADIUS = 56; // px — максимальное отклонение ручки
const JOY_ZONE = 0.42; // доля ширины экрана слева, где палец управляет движением

/**
 * Сенсорное управление в духе Pocket Edition:
 *  - левая часть экрана: плавающий джойстик движения;
 *  - правая часть: поворот камеры свайпом, тап — поставить блок, удержание — ломать;
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
  private lastJumpTap = 0;
  private enabled = false;

  constructor(parent: HTMLElement, state: InputState, actions: InputActions) {
    this.state = state;
    this.actions = actions;

    this.root = document.createElement('div');
    this.root.className = 'touch-controls';
    this.root.innerHTML = `
      <div class="touch-layer"></div>
      <div class="joy-base hidden"><div class="joy-knob"></div></div>
      <button class="touch-btn jump-btn" aria-label="Прыжок">
        <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 3 4 11h5v10h6V11h5z"/></svg>
      </button>
      <button class="touch-btn sneak-btn hidden" aria-label="Вниз">
        <svg viewBox="0 0 24 24" width="30" height="30"><path fill="currentColor" d="M12 21l8-8h-5V3H9v10H4z"/></svg>
      </button>
    `;
    parent.appendChild(this.root);
    this.layer = this.root.querySelector('.touch-layer')!;
    this.joyBase = this.root.querySelector('.joy-base')!;
    this.joyKnob = this.root.querySelector('.joy-knob')!;
    this.jumpBtn = this.root.querySelector('.jump-btn')!;
    this.sneakBtn = this.root.querySelector('.sneak-btn')!;

    this.layer.addEventListener('pointerdown', this.onDown);
    this.layer.addEventListener('pointermove', this.onMove);
    this.layer.addEventListener('pointerup', this.onUp);
    this.layer.addEventListener('pointercancel', this.onUp);
    this.layer.addEventListener('contextmenu', (e) => e.preventDefault());

    this.bindButton(this.jumpBtn, (down) => {
      this.state.jump = down;
      if (down) {
        const now = performance.now();
        if (now - this.lastJumpTap < DOUBLE_TAP_MS) {
          this.actions.toggleFly();
          this.lastJumpTap = 0;
        } else {
          this.lastJumpTap = now;
        }
      }
    });
    this.bindButton(this.sneakBtn, (down) => {
      this.state.sneak = down;
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
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      el.classList.add('active');
      handler(true);
    });
    const up = (e: PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      el.classList.remove('active');
      handler(false);
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onDown = (e: PointerEvent): void => {
    if (!this.enabled || e.pointerType === 'mouse') return;
    e.preventDefault();
    this.layer.setPointerCapture(e.pointerId);
    const width = window.innerWidth;
    if (this.movePointer === null && e.clientX < width * JOY_ZONE) {
      this.movePointer = e.pointerId;
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.joyBase.classList.remove('hidden');
      this.joyBase.style.left = `${e.clientX}px`;
      this.joyBase.style.top = `${e.clientY}px`;
      this.joyKnob.style.transform = 'translate(-50%, -50%)';
      return;
    }
    if (this.lookPointer === null) {
      this.lookPointer = e.pointerId;
      this.lookLast = { x: e.clientX, y: e.clientY };
      this.lookStart = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.lookMoved = 0;
      this.breaking = false;
      this.clearTimers();
      this.holdTimer = window.setTimeout(() => {
        this.holdTimer = null;
        if (this.lookPointer === null || this.lookMoved > TAP_MAX_MOVE_PX) return;
        this.breaking = true;
        this.actions.breakBlock();
        this.breakTimer = window.setInterval(() => this.actions.breakBlock(), BREAK_REPEAT_MS);
      }, HOLD_TO_BREAK_MS);
    }
  };

  private onMove = (e: PointerEvent): void => {
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
      if (mag < 0.15) { mx = 0; mz = 0; }
      this.state.moveX = mx;
      this.state.moveZ = mz;
      // Бег: палец уведён далеко за пределы джойстика вперёд
      this.state.sprint = rawDist > JOY_RADIUS * 1.6 && mz > 0.5;
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

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId === this.movePointer) {
      this.movePointer = null;
      this.state.moveX = 0;
      this.state.moveZ = 0;
      this.state.sprint = false;
      this.joyBase.classList.add('hidden');
      return;
    }
    if (e.pointerId === this.lookPointer) {
      const held = performance.now() - this.lookStart.t;
      const wasBreaking = this.breaking;
      this.clearTimers();
      this.lookPointer = null;
      if (!wasBreaking && held < HOLD_TO_BREAK_MS + 80 && this.lookMoved <= TAP_MAX_MOVE_PX && this.enabled) {
        this.actions.placeBlock();
      }
    }
  };

  private clearTimers(): void {
    if (this.holdTimer !== null) { window.clearTimeout(this.holdTimer); this.holdTimer = null; }
    if (this.breakTimer !== null) { window.clearInterval(this.breakTimer); this.breakTimer = null; }
    this.breaking = false;
  }

  private releaseAll(): void {
    this.clearTimers();
    this.movePointer = null;
    this.lookPointer = null;
    this.joyBase.classList.add('hidden');
    this.state.reset();
  }
}
