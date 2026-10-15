import { BLOCKS, COAL_ORE, COBBLESTONE, DIRT, GRASS, STONE, isWater } from '../world/Blocks.ts';

import { Crafting } from '../crafting/Crafting.ts';
import { insert, itemId } from '../crafting/Items.ts';

export type GameMode = 'creative' | 'survival';

/** Session inventory and vital statistics. No rendering or wall-clock dependencies. */
export class Survival {
  health = 20;
  hunger = 20;
  air = 10;
  food = 0;
  readonly inventory: Crafting;
  constructor(inventory = new Crafting()) { this.inventory = inventory; }
  /** Снимок общего запаса; сами предметы хранятся только в слотах. */
  get blocks(): ReadonlyMap<number, number> {
    const counts = new Map<number, number>();
    for (const s of this.inventory.slots) if (s) counts.set(s.id, (counts.get(s.id) ?? 0) + s.count);
    return counts;
  }
  private recovery = 0;
  private starvation = 0;
  private drowning = 0;

  get dead(): boolean { return this.health <= 0; }
  get canSprint(): boolean { return this.hunger > 6; }
  count(id: number): number { return this.inventory.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0); }
  collect(id: number): number {
    if (!BLOCKS[id]?.breakable || isWater(id)) return 0;
    const drop = id === GRASS ? DIRT : id === STONE ? COBBLESTONE : id === COAL_ORE ? itemId('coal') : id;
    return insert(this.inventory.slots, { id: drop, count: 1 }) === 0 ? drop : 0;
  }
  consumeBlock(id: number): boolean {
    const i = this.inventory.slots.findIndex(s => s?.id === id);
    if (i < 0) return false;
    if (--this.inventory.slots[i]!.count === 0) this.inventory.slots[i] = null;
    return true;
  }
  damage(amount: number): void { this.health = Math.max(0, this.health - Math.max(0, amount)); }
  eat(): boolean {
    if (this.dead || this.food < 1 || this.hunger >= 20) return false;
    this.food--;
    this.hunger = Math.min(20, this.hunger + 6);
    return true;
  }
  update(dt: number, moving: boolean, sprinting: boolean, underwater: boolean): void {
    if (this.dead) return;
    this.hunger = Math.max(0, this.hunger - dt * (moving ? sprinting ? 0.055 : 0.025 : 0.008));
    this.air = underwater ? Math.max(0, this.air - dt) : Math.min(10, this.air + dt * 4);
    this.drowning = underwater && this.air <= 0 ? this.drowning + dt : 0;
    while (this.drowning >= 1) { this.damage(2); this.drowning -= 1; }
    this.starvation = this.hunger === 0 ? this.starvation + dt : 0;
    while (this.starvation >= 4) { this.damage(1); this.starvation -= 4; }
    this.recovery = this.hunger >= 18 && this.health < 20 ? this.recovery + dt : 0;
    while (this.recovery >= 4 && !this.dead) {
      this.health = Math.min(20, this.health + 1);
      this.hunger = Math.max(0, this.hunger - 0.5);
      this.recovery -= 4;
    }
  }
}

/** Repeated mining actions use the same cadence on mouse and touch. */
export class Mining {
  key = '';
  progress = 0;
  idle = 0;
  reset(): void { this.key = ''; this.progress = 0; this.idle = 0; }
  update(dt: number): void { this.idle += dt; if (this.idle > 0.45) this.reset(); }
  strike(key: string, id: number): boolean {
    if (key !== this.key) { this.reset(); this.key = key; }
    this.idle = 0;
    const def = BLOCKS[id];
    const hits = !def.solid ? 1 : /stone|ore|bricks|obsidian/.test(def.key) ? 10 : /log|planks/.test(def.key) ? 6 : 3;
    this.progress = Math.min(1, this.progress + 1 / hits);
    return this.progress >= 1 - 1e-6;
  }
}
