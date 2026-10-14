/** Общее состояние ввода, которое читает игровой цикл каждый кадр. */
export class InputState {
  moveX = 0;
  moveZ = 0;
  jump = false;
  sneak = false;
  sprint = false;
  /** Накопленный поворот камеры за кадр (в «пикселях» экрана). */
  lookDX = 0;
  lookDY = 0;

  /** Сбросить накопленные дельты после применения. */
  consumeLook(): [number, number] {
    const r: [number, number] = [this.lookDX, this.lookDY];
    this.lookDX = 0;
    this.lookDY = 0;
    return r;
  }

  reset(): void {
    this.moveX = 0;
    this.moveZ = 0;
    this.jump = false;
    this.sneak = false;
    this.sprint = false;
    this.lookDX = 0;
    this.lookDY = 0;
  }
}

/** Действия, которые ввод отправляет игре (а не читает по состоянию). */
export interface InputActions {
  breakBlock(): void;
  placeBlock(): void;
  selectHotbar(index: number): void;
  scrollHotbar(delta: number): void;
  toggleFly(): void;
  togglePause(): void;
  toggleInventory(): void;
}
