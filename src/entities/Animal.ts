import { BLOCK_SOLID, DIRT, GRASS, SNOW_GRASS, WATER } from '../world/Blocks.ts';
import type { World } from '../world/World.ts';

export type AnimalKind = 'cow' | 'pig' | 'sheep';
export const ANIMAL_NAMES = { cow: 'Корова', pig: 'Свинья', sheep: 'Овца' };
export const ANIMAL_SIZE = { cow: [0.85, 1.4, 1.6], pig: [0.75, 0.95, 1.25], sheep: [0.85, 1.2, 1.35] } as const;

export class Animal {
  kind: AnimalKind;
  x: number; y: number; z: number;
  yaw = 0;
  targetYaw = 0;
  speed = 0;
  gait = 0;
  health = 8;
  panic = 0;
  hurt = 0;
  grazing = false;
  private decision = 0;
  private vy = 0;
  private random: () => number;

  constructor(kind: AnimalKind, x: number, y: number, z: number, random = Math.random) {
    this.kind = kind; this.x = x; this.y = y; this.z = z; this.random = random;
    this.yaw = this.targetYaw = random() * Math.PI * 2;
  }

  /** Conservative footprint also covers the body while turning. */
  fits(world: World, x: number, y: number, z: number): boolean {
    const r = ANIMAL_SIZE[this.kind][2] / 2;
    for (let bx = Math.floor(x - r); bx <= Math.floor(x + r); bx++) {
      for (let bz = Math.floor(z - r); bz <= Math.floor(z + r); bz++) {
        if (!world.isChunkLoaded(bx, bz)) return false;
        for (let by = Math.floor(y + 0.001); by <= Math.floor(y + ANIMAL_SIZE[this.kind][1] - 0.001); by++) {
          if (world.isSolidForPhysics(bx, by, bz) || world.getBlock(bx, by, bz) === WATER) return false;
        }
      }
    }
    return true;
  }

  ground(world: World, x: number, z: number): number | null {
    // Refuse cliffs, water and unloaded chunks; only climb a single block.
    const r = ANIMAL_SIZE[this.kind][2] / 2;
    for (let y = Math.floor(this.y + 1.01); y >= Math.floor(this.y) - 1; y--) {
      if (!this.fits(world, x, y, z)) continue;
      let supported = true, touchesGround = false;
      for (const dx of [-r, r]) for (const dz of [-r, r]) {
        const bx = Math.floor(x + dx), bz = Math.floor(z + dz);
        const top = BLOCK_SOLID[world.getBlock(bx, y - 1, bz)] === 1;
        touchesGround ||= top;
        if (!top && !BLOCK_SOLID[world.getBlock(bx, y - 2, bz)]) supported = false;
      }
      if (supported && touchesGround) return y;
    }
    return null;
  }

  hit(px: number, pz: number): boolean {
    this.health -= 2;
    this.panic = 4;
    this.hurt = 0.25;
    this.targetYaw = Math.atan2(this.x - px, this.z - pz);
    return this.health <= 0;
  }

  update(dt: number, world: World, neighbors: readonly Animal[]): void {
    this.panic = Math.max(0, this.panic - dt);
    this.hurt = Math.max(0, this.hurt - dt);
    this.decision -= dt;
    if (this.decision <= 0 && this.panic === 0) {
      this.grazing = this.random() < 0.35;
      this.targetYaw = this.yaw + (this.random() - 0.5) * Math.PI;
      this.decision = 2 + this.random() * 4;
    }
    const turn = Math.atan2(Math.sin(this.targetYaw - this.yaw), Math.cos(this.targetYaw - this.yaw));
    this.yaw += Math.max(-dt * 2.5, Math.min(dt * 2.5, turn));
    const desired = this.panic > 0 ? 2.8 : this.grazing ? 0 : 0.8;
    this.speed += (desired - this.speed) * (1 - Math.exp(-4 * dt));
    const x = this.x + Math.sin(this.yaw) * this.speed * dt;
    const z = this.z + Math.cos(this.yaw) * this.speed * dt;
    const ground = this.ground(world, x, z);
    const crowded = neighbors.some(a => a !== this && Math.hypot(a.x - x, a.z - z) < 1.5 && Math.hypot(a.x - x, a.z - z) < Math.hypot(a.x - this.x, a.z - this.z) && Math.abs(a.y - this.y) < 2);
    if (ground !== null && !crowded) {
      const distance = Math.hypot(x - this.x, z - this.z);
      this.x = x; this.z = z;
      this.y = ground;
      this.gait += distance * 5;
      this.vy = 0;
    } else {
      this.speed *= Math.exp(-10 * dt);
      this.targetYaw += dt * 2;
      // Gravity still applies if the player digs away the floor.
      if (this.fits(world, this.x, this.y - 0.05, this.z)) {
        this.vy = Math.max(-12, this.vy - 20 * dt);
        const next = this.y + this.vy * dt;
        if (this.fits(world, this.x, next, this.z)) this.y = next;
        else { this.y = Math.ceil(next); this.vy = 0; }
      }
    }
  }
}

export function canSpawnAnimal(world: World, x: number, y: number, z: number): boolean {
  const floor = world.getBlock(Math.floor(x), y - 1, Math.floor(z));
  return [GRASS, DIRT, SNOW_GRASS].includes(floor);
}

/** Ray / conservative AABB intersection; caller caps distance at the first block. */
export function animalRayDistance(a: Animal, origin: readonly number[], dir: readonly number[], max: number): number | null {
  const r = ANIMAL_SIZE[a.kind][2] / 2;
  const min = [a.x - r, a.y, a.z - r];
  const high = [a.x + r, a.y + ANIMAL_SIZE[a.kind][1], a.z + r];
  let near = 0, far = max;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-8) { if (origin[i] < min[i] || origin[i] > high[i]) return null; continue; }
    const t1 = (min[i] - origin[i]) / dir[i], t2 = (high[i] - origin[i]) / dir[i];
    near = Math.max(near, Math.min(t1, t2)); far = Math.min(far, Math.max(t1, t2));
    if (near > far) return null;
  }
  return near;
}
