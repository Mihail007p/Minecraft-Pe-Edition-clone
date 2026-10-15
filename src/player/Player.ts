// Физика игрока: AABB-коллизии с блоками, гравитация, прыжки, плавание, полёт, автопрыжок.
// Без three.js — только мир и числа, что позволяет тестировать в Node.

import {
  CHUNK_HEIGHT, FLY_SPEED, FLY_VERTICAL_SPEED, GRAVITY, JUMP_VELOCITY, PLAYER_EYE_HEIGHT, PLAYER_HEIGHT,
  PLAYER_WIDTH, SPRINT_SPEED, TERMINAL_VELOCITY, WALK_SPEED, WATER_ACCEL, WATER_DRAG,
  WATER_EXIT_VELOCITY, WATER_FLOAT_DEPTH, WATER_FLOAT_GAIN, WATER_JUMP_VELOCITY, WATER_RISE_SPEED,
  WATER_SINK_SPEED, WATER_SWIM_SPEED,
} from '../config.ts';
import { isWater, liquidSurfaceHeight } from '../world/Blocks.ts';
import type { World } from '../world/World.ts';

export interface MoveInput {
  /** Вправо (+) / влево (−), −1..1. */
  moveX: number;
  /** Вперёд (+) / назад (−), −1..1. */
  moveZ: number;
  jump: boolean;
  /** Присесть / снижаться в полёте. */
  sneak: boolean;
  sprint: boolean;
}

const EPS = 1e-4;
const HALF_W = PLAYER_WIDTH / 2;

export class Player {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Поворот по горизонтали (радианы), 0 — взгляд вдоль −Z. */
  yaw = 0;
  /** Наклон (радианы), положительный — вверх. */
  pitch = 0;
  onGround = false;
  flying = false;
  inWater = false;
  headInWater = false;
  /** Высота видимой поверхности воды над игроком (мировая Y); null, если игрок не в воде. */
  waterSurfaceY: number | null = null;
  /** Верхняя грань самого верхнего блока воды в столбе игрока: по ней определяется «голова в воде». */
  private waterTopY = 0;
  landedDistance = 0;
  private fallTop = 0;
  /** Ещё действует подтягивание на берег после выхода из воды. */
  private climbTimer = 0;
  private world: World;

  constructor(world: World) {
    this.world = world;
  }

  teleport(x: number, y: number, z: number): void {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.fallTop = y;
    this.landedDistance = 0;
    this.onGround = false;
    this.climbTimer = 0;
  }

  rotate(dyaw: number, dpitch: number): void {
    this.yaw = (this.yaw + dyaw) % (Math.PI * 2);
    const limit = Math.PI / 2 - 0.001;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch + dpitch));
  }

  get eyeY(): number {
    return this.y + PLAYER_EYE_HEIGHT;
  }

  /** Единичный вектор взгляда. */
  lookDirection(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /** Пересекается ли AABB игрока с блоком (для запрета установки блока «в себя»). */
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    return (
      bx + 1 > this.x - HALF_W && bx < this.x + HALF_W &&
      by + 1 > this.y && by < this.y + PLAYER_HEIGHT &&
      bz + 1 > this.z - HALF_W && bz < this.z + HALF_W
    );
  }

  update(dt: number, input: MoveInput, autoJump: boolean): void {
    this.landedDistance = 0;
    const world = this.world;
    const feetBlock = world.getBlock(Math.floor(this.x), Math.floor(this.y + 0.3), Math.floor(this.z));
    const midBlock = world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.0), Math.floor(this.z));
    this.inWater = isWater(feetBlock) || isWater(midBlock);
    this.headInWater = isWater(world.getBlock(Math.floor(this.x), Math.floor(this.eyeY), Math.floor(this.z)));
    this.waterSurfaceY = this.inWater ? this.findWaterSurface() : null;

    if (this.flying || this.inWater || this.onGround) this.fallTop = this.y;
    this.fallTop = Math.max(this.fallTop, this.y);

    // --- Горизонтальное желаемое направление в мировых координатах ---
    let mx = input.moveX;
    let mz = input.moveZ;
    const mlen = Math.hypot(mx, mz);
    if (mlen > 1) { mx /= mlen; mz /= mlen; }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    // forward = (−sin, −cos), right = (cos, −sin)
    const wx = -sinY * mz + cosY * mx;
    const wz = -cosY * mz - sinY * mx;

    let speed: number;
    let accel: number;
    if (this.flying) {
      speed = FLY_SPEED * (input.sprint ? 1.8 : 1);
      accel = 10;
    } else if (this.inWater) {
      speed = WATER_SWIM_SPEED;
      accel = 6;
    } else if (this.onGround) {
      speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      accel = 18;
    } else {
      speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
      accel = 4;
    }
    const k = 1 - Math.exp(-accel * dt);
    this.vx += (wx * speed - this.vx) * k;
    this.vz += (wz * speed - this.vz) * k;

    // --- Вертикаль ---
    if (this.climbTimer > 0) {
      // Подтягиваемся на берег/блок: короткий устойчивый подъём.
      this.climbTimer = Math.max(0, this.climbTimer - dt);
      this.vy += (WATER_EXIT_VELOCITY - this.vy) * (1 - Math.exp(-8 * dt));
    } else if (this.flying) {
      const target = (input.jump ? 1 : 0) - (input.sneak ? 1 : 0);
      this.vy += (target * FLY_VERTICAL_SPEED - this.vy) * (1 - Math.exp(-14 * dt));
    } else if (this.inWater) {
      const atSurface = !this.headInWater;
      const k = 1 - Math.exp(-WATER_ACCEL * dt);
      // Уровень плавания: ступни на WATER_FLOAT_DEPTH ниже поверхности — вода у шеи, голова снаружи.
      // Пружина тянет к нему и сверху, и снизу, поэтому человек не «всплывает на воду» и не тонет.
      // Над блоком текучей воды видимая поверхность ниже его верха — глаза всё равно держим над блоком.
      const floatY = this.waterSurfaceY === null
        ? this.y
        : Math.max(this.waterSurfaceY - WATER_FLOAT_DEPTH, this.waterTopY + 0.05 - PLAYER_EYE_HEIGHT);
      const floatError = floatY - this.y;
      const buoyancy = Math.max(-WATER_SINK_SPEED, Math.min(WATER_RISE_SPEED, floatError * WATER_FLOAT_GAIN));
      if (input.jump && this.onGround) {
        // Прыжок со дна/мелководья — например, чтобы выбраться на берег.
        this.vy = JUMP_VELOCITY * 0.75;
      } else if (input.jump) {
        // У поверхности — выпрыгиваем из воды, глубже — всплываем.
        this.vy += ((atSurface ? WATER_JUMP_VELOCITY : WATER_SWIM_SPEED + 1) - this.vy) * k;
      } else if (input.sneak) {
        this.vy += (-WATER_SWIM_SPEED - this.vy) * k; // нырять
      } else {
        const moving = Math.hypot(this.vx, this.vz) > 0.5 && !this.onGround;
        if (moving) {
          // Плывём в направлении взгляда: смотрим вниз — ныряем, вверх — всплываем.
          // У поверхности корпус держится на воде, поэтому к взгляду добавляется только возврат к уровню плавания.
          const target = Math.sin(this.pitch) * WATER_SWIM_SPEED + (atSurface ? buoyancy : 0.3);
          this.vy += (target - this.vy) * (1 - Math.exp(-4 * dt));
        } else if (!this.onGround) {
          // Плавучесть: глубоко вода выталкивает вверх, у поверхности плавно выводит тело на уровень плавания.
          this.vy += (buoyancy - this.vy) * k;
        }
      }
      this.vy *= Math.max(0, 1 - WATER_DRAG * dt);
      if (this.vy < -4) this.vy = -4;
    } else {
      this.vy -= GRAVITY * dt;
      if (this.vy < -TERMINAL_VELOCITY) this.vy = -TERMINAL_VELOCITY;
      if (input.jump && this.onGround) {
        this.vy = JUMP_VELOCITY;
        this.onGround = false;
      }
    }

    // --- Перемещение с коллизиями по осям ---
    const wasOnGround = this.onGround;
    const prevX = this.x;
    const prevZ = this.z;
    this.onGround = false;
    const hitY = this.sweep(1, this.vy * dt);
    if (hitY) {
      if (this.vy < 0) this.onGround = true;
      this.vy = 0;
    }
    const dx = this.vx * dt;
    const dz = this.vz * dt;
    const hitX = this.sweep(0, dx);
    const hitZ = this.sweep(2, dz);

    // Автопрыжок и выход из воды на берег (как в Pocket Edition).
    let stepped = false;
    const moving = (Math.abs(dx) + Math.abs(dz)) > 0.0005;
    if ((hitX || hitZ) && !this.flying && !input.sneak && moving) {
      if (this.inWater) {
        // Плавание: упёрлись в берег/блок — подтягиваемся наверх (автопрыжок или кнопка прыжка).
        if ((autoJump || input.jump) && this.canClimbOutOfWater(dx, dz)) {
          this.vy = Math.max(this.vy, WATER_EXIT_VELOCITY);
          this.climbTimer = 0.3;
          stepped = true;
        }
      } else if (autoJump && (wasOnGround || this.onGround)) {
        const stepUp = 1.0 + EPS * 4;
        const canStep =
          !this.collides(prevX + dx, this.y + stepUp, prevZ + dz) &&
          !this.collides(this.x, this.y + stepUp, this.z);
        if (canStep) {
          this.vy = JUMP_VELOCITY * 0.95;
          this.onGround = false;
          stepped = true;
        }
      }
    }
    if (!stepped) {
      if (hitX) this.vx = 0;
      if (hitZ) this.vz = 0;
    }

    if (this.onGround && !this.flying && !this.inWater) {
      this.landedDistance = Math.max(0, this.fallTop - this.y);
      this.fallTop = this.y;
    }

    if (this.flying && this.onGround && input.sneak) this.flying = false;
  }

  /**
   * Высота видимой поверхности воды в столбе игрока: идём вверх от блока воды у его тела, пока вода не кончится.
   * Источник поднимается не до края блока (см. liquidSurfaceHeight), текущая вода ещё ниже.
   */
  private findWaterSurface(): number | null {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    let by = Math.floor(this.y + 0.3);
    if (!isWater(this.world.getBlock(bx, by, bz))) by = Math.floor(this.y + 1.0);
    if (!isWater(this.world.getBlock(bx, by, bz))) return null;
    while (by + 1 < CHUNK_HEIGHT && isWater(this.world.getBlock(bx, by + 1, bz))) by++;
    this.waterTopY = by + 1;
    return by + liquidSurfaceHeight(this.world.getBlock(bx, by, bz));
  }

  toggleFly(): void {
    this.flying = !this.flying;
    if (this.flying) this.vy = Math.max(this.vy, 0);
  }

  /**
   * Можно ли залезть на блок/берег перед собой из воды: впереди есть твёрдая опора
   * не выше ~2 блоков над ногами, а над ней есть место встать.
   */
  private canClimbOutOfWater(dx: number, dz: number): boolean {
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const ux = dx / len;
    const uz = dz / len;
    const fx = Math.floor(this.x + ux * (HALF_W + 0.25));
    const fz = Math.floor(this.z + uz * (HALF_W + 0.25));
    // По грудь в воде можно подтянуться выше (помогает плавучесть). На плаву ступни глубоко под водой,
    // поэтому запас хватает и на берег, который на блок выше поверхности.
    const deep = isWater(this.world.getBlock(Math.floor(this.x), Math.floor(this.y + 1.0), Math.floor(this.z)));
    const maxClimb = deep ? 2.5 : 1.2;
    const baseY = Math.floor(this.y + 0.05);
    for (let up = -1; up <= 2; up++) {
      const by = baseY + up;
      if (!this.world.isSolidForPhysics(fx, by, fz)) continue;
      const standY = by + 1;
      const rise = standY - this.y;
      if (rise <= 0.05 || rise > maxClimb) continue;
      if (this.collides(this.x + ux * 0.6, standY + 2 * EPS, this.z + uz * 0.6)) continue;
      return true;
    }
    return false;
  }

  collides(x: number, y: number, z: number): boolean {
    const minX = Math.floor(x - HALF_W + EPS);
    const maxX = Math.floor(x + HALF_W - EPS);
    const minY = Math.floor(y + EPS);
    const maxY = Math.floor(y + PLAYER_HEIGHT - EPS);
    const minZ = Math.floor(z - HALF_W + EPS);
    const maxZ = Math.floor(z + HALF_W - EPS);
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (this.world.isSolidForPhysics(bx, by, bz)) return true;
        }
      }
    }
    return false;
  }

  /**
   * Сдвиг по одной оси с точным прижатием к препятствию. Возвращает true при столкновении.
   * axis: 0 — x, 1 — y, 2 — z.
   */
  private sweep(axis: 0 | 1 | 2, delta: number): boolean {
    if (delta === 0) return false;
    const pos = axis === 0 ? this.x : axis === 1 ? this.y : this.z;
    const target = pos + delta;
    // Размах AABB по оси движения: от старого до нового положения, чтобы не проскакивать блоки.
    const extentMin = axis === 1 ? 0 : -HALF_W;
    const extentMax = axis === 1 ? PLAYER_HEIGHT : HALF_W;
    const lo = Math.min(pos, target) + extentMin;
    const hi = Math.max(pos, target) + extentMax;

    const minX = axis === 0 ? Math.floor(lo + EPS) : Math.floor(this.x - HALF_W + EPS);
    const maxX = axis === 0 ? Math.floor(hi - EPS) : Math.floor(this.x + HALF_W - EPS);
    const minY = axis === 1 ? Math.floor(lo + EPS) : Math.floor(this.y + EPS);
    const maxY = axis === 1 ? Math.floor(hi - EPS) : Math.floor(this.y + PLAYER_HEIGHT - EPS);
    const minZ = axis === 2 ? Math.floor(lo + EPS) : Math.floor(this.z - HALF_W + EPS);
    const maxZ = axis === 2 ? Math.floor(hi - EPS) : Math.floor(this.z + HALF_W - EPS);

    // Блоки, уже пересекающие текущий AABB (застревание), не считаем препятствием —
    // иначе из них нельзя было бы выбраться.
    const OVERLAP = 1e-3;
    let limit = target;
    let hit = false;
    for (let by = minY; by <= maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        for (let bx = minX; bx <= maxX; bx++) {
          if (!this.world.isSolidForPhysics(bx, by, bz)) continue;
          const b = axis === 0 ? bx : axis === 1 ? by : bz;
          if (delta > 0) {
            if (b < pos + extentMax - OVERLAP) continue; // блок уже внутри нас
            // Упираемся передней гранью в ближнюю грань блока
            const allowed = Math.max(pos, b - extentMax - EPS);
            if (allowed < limit) { limit = allowed; hit = true; }
          } else {
            if (b + 1 > pos + extentMin + OVERLAP) continue;
            const allowed = Math.min(pos, b + 1 - extentMin + EPS);
            if (allowed > limit) { limit = allowed; hit = true; }
          }
        }
      }
    }
    if (axis === 0) this.x = limit;
    else if (axis === 1) this.y = limit;
    else this.z = limit;
    return hit;
  }
}
