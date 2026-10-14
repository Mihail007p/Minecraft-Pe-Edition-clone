import { BREAK_REPEAT_MS, DOUBLE_TAP_MS } from '../config.ts';
import type { InputActions, InputState } from './InputState.ts';

/**
 * Управление клавиатурой и мышью (для настольных браузеров и отладки):
 * WASD, пробел, Shift, Ctrl — бег, ЛКМ — ломать, ПКМ — ставить, колесо/цифры — хотбар,
 * E — инвентарь, F или двойной пробел — полёт, Esc — пауза (через выход из pointer lock).
 */
export class KeyboardMouse {
  private canvas: HTMLCanvasElement;
  private state: InputState;
  private actions: InputActions;
  private keys = new Set<string>();
  private enabled = false;
  private breakTimer: number | null = null;
  private placeTimer: number | null = null;
  private lastSpace = 0;
  /** Вызывается, когда pointer lock потерян во время игры (например, Esc). */
  onPointerLockLost: (() => void) | null = null;

  /**
   * @param canvas элемент, захватывающий курсор
   * @param surface контейнер, на котором ловим нажатия мыши (поверх канваса может лежать сенсорный слой)
   */
  constructor(canvas: HTMLCanvasElement, surface: HTMLElement, state: InputState, actions: InputActions) {
    this.canvas = canvas;
    this.state = state;
    this.actions = actions;

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
    surface.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    surface.addEventListener('wheel', this.onWheel, { passive: false });
    surface.addEventListener('contextmenu', (e) => {
      if (!(e.target as HTMLElement).closest('input, textarea')) e.preventDefault();
    });
    document.addEventListener('pointerlockchange', () => {
      if (!this.isLocked() && this.enabled) {
        this.releaseAll();
        this.onPointerLockLost?.();
      }
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.releaseAll();
  }

  isLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  /** Захват курсора — вызывать из обработчика пользовательского действия. */
  requestLock(): void {
    if (this.isLocked() || typeof this.canvas.requestPointerLock !== 'function') return;
    const plain = () => {
      try {
        const r = this.canvas.requestPointerLock() as unknown;
        if (r instanceof Promise) r.catch(() => undefined);
      } catch { /* не поддерживается (например, сенсорные устройства) */ }
    };
    try {
      const r = this.canvas.requestPointerLock({ unadjustedMovement: true } as PointerLockOptions) as unknown;
      if (r instanceof Promise) {
        r.catch((err: unknown) => {
          // Без «сырых» движений мыши — повторяем обычный захват
          if ((err as { name?: string })?.name === 'NotSupportedError') plain();
        });
      }
    } catch {
      plain();
    }
  }

  exitLock(): void {
    if (this.isLocked() && typeof document.exitPointerLock === 'function') document.exitPointerLock();
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (!this.enabled) return;
    if (e.repeat) { this.updateMovement(); return; }
    this.keys.add(e.code);
    switch (e.code) {
      case 'Space': {
        const now = performance.now();
        if (now - this.lastSpace < DOUBLE_TAP_MS) { this.actions.toggleFly(); this.lastSpace = 0; }
        else this.lastSpace = now;
        e.preventDefault();
        break;
      }
      case 'KeyR': this.actions.eat?.(); break;
      case 'KeyF': this.actions.toggleFly(); break;
      case 'KeyE': this.actions.toggleInventory(); break;
      case 'KeyP': this.actions.togglePause(); break;
      case 'Tab': e.preventDefault(); break;
      default:
        if (e.code.startsWith('Digit')) {
          const n = Number(e.code.slice(5));
          if (n >= 1 && n <= 9) this.actions.selectHotbar(n - 1);
        }
    }
    this.updateMovement();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    this.updateMovement();
  };

  private updateMovement(): void {
    const k = this.keys;
    this.state.moveZ = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    this.state.moveX = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    this.state.jump = k.has('Space');
    this.state.sneak = k.has('ShiftLeft') || k.has('ShiftRight');
    this.state.sprint = k.has('ControlLeft') || k.has('ControlRight');
  }

  private onMouseDown = (e: MouseEvent): void => {
    if (!this.enabled) return;
    // Android может породить совместимый mousedown после касания. Это не мышь:
    // pointer lock на тач-устройстве способен обнулить clientX/clientY касаний.
    if ((e as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents) return;
    // Клики по кнопкам интерфейса — не игровые действия
    if ((e.target as HTMLElement).closest('button, input, .panel, .menu-box')) return;
    if (!this.isLocked()) {
      this.requestLock();
      return;
    }
    e.preventDefault();
    if (e.button === 0) {
      this.actions.breakBlock();
      this.clearBreak();
      this.breakTimer = window.setInterval(() => this.actions.breakBlock(), BREAK_REPEAT_MS);
    } else if (e.button === 2) {
      this.actions.placeBlock();
      if (!this.enabled) return;
      this.clearPlace();
      this.placeTimer = window.setInterval(() => this.actions.placeBlock(), BREAK_REPEAT_MS);
    }
  };

  private onMouseUp = (e: MouseEvent): void => {
    if (e.button === 0) this.clearBreak();
    if (e.button === 2) this.clearPlace();
  };

  private onMouseMove = (e: MouseEvent): void => {
    if (!this.enabled || !this.isLocked()) return;
    this.state.lookDX += e.movementX;
    this.state.lookDY += e.movementY;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    if ((e.target as HTMLElement).closest('.panel, .menu-box')) return;
    e.preventDefault();
    this.actions.scrollHotbar(e.deltaY > 0 ? 1 : -1);
  };

  private clearBreak(): void {
    if (this.breakTimer !== null) { window.clearInterval(this.breakTimer); this.breakTimer = null; }
  }

  private clearPlace(): void {
    if (this.placeTimer !== null) { window.clearInterval(this.placeTimer); this.placeTimer = null; }
  }

  private releaseAll(): void {
    this.keys.clear();
    this.clearBreak();
    this.clearPlace();
    this.state.reset();
  }
}
