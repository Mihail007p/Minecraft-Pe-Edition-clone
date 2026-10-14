import { copySlots, insert, ITEM_BY_ID, type Slot } from './Items.ts';
import { findRecipe, fits, matchRecipe, type Recipe } from './Recipes.ts';

/** Чистая модель: UI не меняет стеки в обход транзакций. */
export class Crafting {
  slots: Slot[] = Array(36).fill(null);
  grid: Slot[] = Array(4).fill(null);
  cursor: Slot = null;
  size: 2 | 3 = 2;

  reset(hotbar: readonly number[]): void {
    this.slots = Array(36).fill(null);
    hotbar.forEach((id, i) => { this.slots[i] = id ? { id, count: 64 } : null; });
    this.grid = Array(4).fill(null);
    this.cursor = null;
    this.size = 2;
  }

  get result(): Recipe | undefined { return findRecipe(this.grid, this.size); }

  setSize(size: 2 | 3): boolean {
    if (!this.returnAll()) return false;
    this.size = size;
    this.grid = Array(size * size).fill(null);
    return true;
  }

  /** Возврат при закрытии: всё или ничего, даже при полном инвентаре. */
  returnAll(): boolean {
    const slots = copySlots(this.slots);
    for (const stack of [...this.grid, this.cursor]) {
      if (stack && insert(slots, stack) > 0) return false;
    }
    this.slots = slots;
    this.grid.fill(null);
    this.cursor = null;
    return true;
  }

  /** ЛКМ/тап переносит стек, ПКМ/режим «По одному» берёт половину или кладёт один. */
  click(area: 'slots' | 'grid', index: number, single = false): void {
    const slots = this[area];
    if (index < 0 || index >= slots.length) return;
    const target = slots[index];
    if (!this.cursor) {
      if (!target) return;
      const count = single ? Math.ceil(target.count / 2) : target.count;
      this.cursor = { id: target.id, count };
      target.count -= count;
      if (!target.count) slots[index] = null;
    } else if (!target || target.id === this.cursor.id) {
      const room = ITEM_BY_ID.get(this.cursor.id)!.maxStack - (target?.count ?? 0);
      const count = Math.min(single ? 1 : this.cursor.count, room);
      if (!count) return;
      slots[index] = { id: this.cursor.id, count: (target?.count ?? 0) + count };
      this.cursor.count -= count;
      if (!this.cursor.count) this.cursor = null;
    } else if (!single) {
      slots[index] = this.cursor;
      this.cursor = target;
    }
  }

  /** Проверка доступности и автозаполнение используют один и тот же алгоритм. */
  private prepare(recipe: Recipe): { slots: Slot[]; grid: Slot[] } | null {
    if (!fits(recipe, this.size) || this.cursor) return null;
    const slots = copySlots(this.slots);
    // Сначала собираем общий пул: сетку можно использовать в следующем рецепте.
    for (const stack of this.grid) if (stack) slots.push({ ...stack });
    const grid: Slot[] = Array(this.size * this.size).fill(null);
    const assign = (n: number): boolean => {
      if (n === recipe.ingredients.length) return true;
      const choices = recipe.ingredients[n];
      if (!choices) return assign(n + 1);
      const index = recipe.shapeless ? n : Math.floor(n / recipe.width) * this.size + n % recipe.width;
      const tried = new Set<number>();
      for (let i = 0; i < slots.length; i++) {
        const stack = slots[i];
        if (!stack || stack.count <= 0 || !choices.includes(stack.id) || tried.has(stack.id)) continue;
        tried.add(stack.id);
        stack.count--;
        grid[index] = { id: stack.id, count: 1 };
        if (assign(n + 1)) return true;
        stack.count++;
        grid[index] = null;
      }
      return false;
    };
    if (!assign(0)) return null;
    const packed: Slot[] = Array(36).fill(null);
    // Сохраняем расположение хотбара и сумки, не сортируем их при каждом крафте.
    for (let i = 0; i < 36; i++) if (slots[i]?.count) packed[i] = slots[i];
    for (const stack of slots.slice(36)) if (stack?.count && insert(packed, stack)) return null;
    return { slots: packed, grid };
  }

  canFill(recipe: Recipe): boolean { return this.prepare(recipe) !== null; }

  fill(recipe: Recipe, maximum = false): boolean {
    const state = this.prepare(recipe);
    if (!state) return false;
    if (maximum) {
      const needs = new Map<number, number>();
      for (const s of state.grid) if (s) needs.set(s.id, (needs.get(s.id) ?? 0) + 1);
      let extra = Infinity;
      for (const [id, perCraft] of needs) {
        const available = state.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0);
        extra = Math.min(extra, Math.floor(available / perCraft), ITEM_BY_ID.get(id)!.maxStack - 1);
      }
      for (const target of state.grid) if (target) {
        let left = extra;
        for (let i = 0; i < state.slots.length && left > 0; i++) {
          const stack = state.slots[i];
          if (stack?.id !== target.id) continue;
          const n = Math.min(stack.count, left);
          stack.count -= n; left -= n; target.count += n;
          if (!stack.count) state.slots[i] = null;
        }
      }
    }
    this.slots = state.slots;
    this.grid = state.grid;
    return true;
  }

  /** Результат берётся на курсор; Shift/«Создать всё» — в инвентарь до заполнения. */
  craft(all = false): number {
    const recipe = this.result;
    if (!recipe) return 0;
    let made = 0;
    do {
      const indices = matchRecipe(recipe, this.grid, this.size);
      if (!indices) break;
      if (all) {
        const slots = copySlots(this.slots);
        if (insert(slots, recipe.result)) break;
        this.slots = slots;
      } else {
        if (this.cursor && this.cursor.id !== recipe.result.id) break;
        const count = (this.cursor?.count ?? 0) + recipe.result.count;
        if (count > ITEM_BY_ID.get(recipe.result.id)!.maxStack) break;
        this.cursor = { id: recipe.result.id, count };
      }
      for (const index of indices) {
        if (--this.grid[index]!.count === 0) this.grid[index] = null;
      }
      made += recipe.result.count;
    } while (all);
    return made;
  }
}
