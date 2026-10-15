// Растекание воды — клеточная автоматика в духе Minecraft, без three.js и рендера.
//
// Правила для одной ячейки:
//  • источник (WATER) постоянен и никогда не меняется;
//  • если над ячейкой вода — это падение: на твёрдом дне вода становится текущей
//    уровнем 1 и разливается вбок, иначе — падающий столб (WATER_FALL);
//  • иначе ячейка заполняется текущей водой уровня min(соседи)+1 (источник даёт 1),
//    но не дальше уровня 7 — дальше вода не растекается;
//  • текущая вода без питания (соседи с меньшим уровнем / источник) высыхает,
//    поэтому после удаления источника разлив постепенно исчезает.
//
// Изменения блоков ставятся в очередь и обрабатываются импульсами, чтобы
// растекание было видно глазу и не съедало кадр.

import { WATER_CELLS_PER_PULSE, WATER_PULSE_INTERVAL, CHUNK_HEIGHT } from '../config.ts';
import { AIR, BLOCK_REPLACEABLE, BLOCK_SOLID, WATER, WATER_FALL, isWater, waterFlowId, waterLevel } from './Blocks.ts';
import type { World } from './World.ts';

const MAX_LEVEL = 7;
/** Соседи для планирования пересчёта (включая блок ниже и выше — выше добавляется отдельно). */
const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0],
];
/** Горизонтальные соседи — вода растекается только вбок (падение обрабатывается отдельно). */
const SIDE_NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export class WaterSim {
  private world: World;
  private queue: string[] = [];
  private queued = new Set<string>();
  private pulseAcc = 0;
  /** Сколько ячеек всего обработано (отладка и тесты). */
  updates = 0;

  constructor(world: World) {
    this.world = world;
  }

  /** Сколько ячеек ждут пересчёта. */
  get pending(): number {
    return this.queue.length;
  }

  /** Поставить в очередь ячейку и её соседей (вызывается при изменении блоков). */
  schedule(x: number, y: number, z: number): void {
    this.push(x, y, z);
    for (const [dx, dy, dz] of NEIGHBORS) this.push(x + dx, y + dy, z + dz);
    this.push(x, y + 1, z);
  }

  private push(x: number, y: number, z: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const key = `${x},${y},${z}`;
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
  }

  /** Обработать до maxCells ячеек из очереди. Возвращает число обработанных. */
  step(maxCells = WATER_CELLS_PER_PULSE): number {
    let n = 0;
    while (n < maxCells && this.queue.length > 0) {
      const key = this.queue.shift()!;
      this.queued.delete(key);
      const comma1 = key.indexOf(',');
      const comma2 = key.indexOf(',', comma1 + 1);
      this.updateCell(
        Number(key.slice(0, comma1)),
        Number(key.slice(comma1 + 1, comma2)),
        Number(key.slice(comma2 + 1)),
      );
      n++;
    }
    this.updates += n;
    return n;
  }

  /** Плавное продвижение симуляции по времени (вызывается из игрового цикла). */
  update(dt: number): void {
    this.pulseAcc += dt;
    while (this.pulseAcc >= WATER_PULSE_INTERVAL) {
      this.pulseAcc -= WATER_PULSE_INTERVAL;
      if (this.step() === 0) break;
    }
    // Не копим «хвост» времени, когда очередь пуста.
    if (this.queue.length === 0) this.pulseAcc = Math.min(this.pulseAcc, WATER_PULSE_INTERVAL);
  }

  /** Прогнать очередь до успокоения (для тестов). */
  runUntilIdle(limit = 20000): void {
    while (this.queue.length > 0 && limit-- > 0) this.step(64);
  }

  private updateCell(x: number, y: number, z: number): void {
    const world = this.world;
    const id = world.getBlock(x, y, z);
    if (id === WATER) return; // источник постоянен
    if (id !== AIR && !isWater(id) && BLOCK_REPLACEABLE[id] !== 1) return; // твёрдое — не трогаем

    const desired = this.computeDesired(x, y, z);
    if (desired === id) return;
    if (desired === AIR) {
      // Высыхает только вода; растения и прочее не вычищаем.
      if (isWater(id)) world.setBlock(x, y, z, AIR);
      return;
    }
    world.setBlock(x, y, z, desired);
  }

  /** Какой блок воды должен стоять в ячейке по её окружению (AIR — если никакой). */
  private computeDesired(x: number, y: number, z: number): number {
    const world = this.world;
    const above = world.getBlock(x, y + 1, z);
    if (isWater(above)) {
      // Над нами вода: падаем. На твёрдом дне — разлив уровнем 1.
      return BLOCK_SOLID[world.getBlock(x, y - 1, z)] === 1 ? waterFlowId(1) : WATER_FALL;
    }
    let best = MAX_LEVEL + 1;
    for (const [dx, dz] of SIDE_NEIGHBORS) {
      const n = world.getBlock(x + dx, y, z + dz);
      if (n === WATER) best = Math.min(best, 1);
      else if (isWater(n) && n !== WATER_FALL) best = Math.min(best, waterLevel(n) + 1);
    }
    return best <= MAX_LEVEL ? waterFlowId(best) : AIR;
  }
}
