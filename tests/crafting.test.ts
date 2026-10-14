import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Crafting } from '../src/crafting/Crafting.ts';
import { copySlots, insert, ITEMS, ITEM_BY_ID, itemId, type Slot } from '../src/crafting/Items.ts';
import { findRecipe, fits, matchRecipe, RECIPES, type Recipe } from '../src/crafting/Recipes.ts';
import { Survival } from '../src/player/Survival.ts';
import { LOG, PLANKS } from '../src/world/Blocks.ts';

const recipe = (id: string) => RECIPES.find(r => r.id === id)!;
const stack = (key: string, count = 1) => ({ id: itemId(key), count });
function layout(r: Recipe, size: number, x = 0, y = 0, mirror = false): Slot[] {
  const grid: Slot[] = Array(size * size).fill(null);
  r.ingredients.forEach((ingredient, i) => {
    if (!ingredient) return;
    const index = r.shapeless ? i : (y + Math.floor(i / r.width)) * size + x + (mirror ? r.width - 1 - i % r.width : i % r.width);
    grid[index] = { id: ingredient[0], count: 1 };
  });
  return grid;
}
const snapshot = (c: Crafting) => JSON.stringify({ slots: c.slots, grid: c.grid, cursor: c.cursor });

test('catalogue: unique ids, valid ingredients, output counts and limits', () => {
  assert.equal(new Set(ITEMS.map(i => i.id)).size, ITEMS.length);
  assert.equal(new Set(ITEMS.map(i => i.key)).size, ITEMS.length);
  assert.equal(new Set(RECIPES.map(r => r.id)).size, RECIPES.length);
  assert.ok(RECIPES.length >= 100);
  for (const r of RECIPES) {
    assert.ok(r.result.count > 0 && r.result.count <= ITEM_BY_ID.get(r.result.id)!.maxStack, r.id);
    for (const group of r.ingredients) if (group) {
      assert.ok(group.length > 0);
      group.forEach(id => assert.ok(ITEM_BY_ID.has(id), r.id));
    }
    if (!r.shapeless) assert.equal(r.ingredients.length, r.width * r.height);
  }
});

test('every recipe matches its pattern, offsets and mirror; table-only recipes reject 2x2', () => {
  for (const r of RECIPES) {
    assert.ok(matchRecipe(r, layout(r, 3), 3), r.id);
    if (!r.shapeless) {
      for (let x = 0; x <= 3 - r.width; x++) for (let y = 0; y <= 3 - r.height; y++) {
        for (const mirrored of [false, true]) assert.ok(matchRecipe(r, layout(r, 3, x, y, mirrored), 3), r.id);
      }
    }
    if (fits(r, 2)) assert.ok(matchRecipe(r, layout(r, 2), 2), r.id);
    else assert.equal(matchRecipe(r, Array(4).fill(null), 2), null, r.id);
  }
});

test('shaped recipes reject rotations, extra ingredients and filled holes', () => {
  assert.equal(findRecipe([stack('planks'), stack('planks'), null, null], 2), undefined);
  const grid = layout(recipe('chest'), 3);
  grid[4] = stack('planks');
  assert.equal(matchRecipe(recipe('chest'), grid, 3), null);
  const sticks = layout(recipe('sticks'), 3, 2, 1);
  sticks[0] = stack('dirt');
  assert.equal(matchRecipe(recipe('sticks'), sticks, 3), null);
});

test('shapeless recipes allow permutations, not one cell with several ingredients', () => {
  const book = recipe('book');
  assert.ok(matchRecipe(book, [stack('paper'), stack('leather'), stack('paper'), stack('paper')], 2));
  assert.equal(matchRecipe(book, [stack('paper', 3), stack('leather'), null, null], 2), null);
  const wool = recipe('wool_red');
  assert.ok(matchRecipe(wool, [stack('red_dye'), null, stack('wool_blue'), null], 2));
});

test('stack limits, splitting odd amounts, placing one, swapping and merging', () => {
  const c = new Crafting();
  c.slots[0] = stack('log', 5);
  c.click('slots', 0, true);
  assert.deepEqual(c.cursor, stack('log', 3));
  assert.deepEqual(c.slots[0], stack('log', 2));
  c.click('grid', 0, true);
  assert.deepEqual(c.grid[0], stack('log'));
  assert.deepEqual(c.cursor, stack('log', 2));
  c.slots[1] = stack('log', 63);
  c.click('slots', 1);
  assert.equal(c.slots[1]!.count, 64);
  assert.equal(c.cursor!.count, 1);
  c.slots[2] = stack('stone');
  c.click('slots', 2);
  assert.deepEqual(c.cursor, stack('stone'));
  assert.deepEqual(c.slots[2], stack('log'));
  const slots: Slot[] = [null, null];
  assert.equal(insert(slots, stack('wooden_pickaxe', 3)), 1);
  assert.deepEqual(slots, [stack('wooden_pickaxe'), stack('wooden_pickaxe')]);
});

test('taking result consumes one from each cell and respects cursor capacity', () => {
  const c = new Crafting();
  c.grid[2] = stack('log', 5);
  assert.equal(c.craft(), 4);
  assert.deepEqual(c.cursor, stack('planks', 4));
  assert.equal(c.grid[2]!.count, 4);
  c.cursor = stack('planks', 63);
  const before = snapshot(c);
  assert.equal(c.craft(), 0);
  assert.equal(snapshot(c), before);
  c.cursor = stack('stone');
  assert.equal(c.craft(), 0);
});

test('bulk crafting stops without losing ingredients when inventory is full', () => {
  const c = new Crafting();
  c.slots = Array.from({ length: 36 }, () => stack('stone', 64));
  c.slots[0] = stack('planks', 58);
  c.grid[0] = stack('log', 3);
  assert.equal(c.craft(true), 4);
  assert.equal(c.slots[0]!.count, 62);
  assert.equal(c.grid[0]!.count, 2);
  const before = snapshot(c);
  assert.equal(c.craft(true), 0);
  assert.equal(snapshot(c), before);
});

test('autofill shares exact availability logic, returns old ingredients, is atomic', () => {
  const c = new Crafting();
  c.slots[0] = stack('planks', 3);
  c.grid[0] = stack('planks');
  assert.equal(c.canFill(recipe('crafting_table')), true);
  assert.equal(c.fill(recipe('crafting_table')), true);
  assert.equal(c.result?.id, 'crafting_table');
  assert.equal(c.slots[0], null);
  assert.equal(c.grid.filter(Boolean).length, 4);
  const before = snapshot(c);
  assert.equal(c.fill(recipe('wooden_pickaxe')), false);
  assert.equal(snapshot(c), before);
  c.cursor = stack('dirt');
  assert.equal(c.canFill(recipe('crafting_table')), false);
});

test('maximum autofill and craft-all create the available number, no duplication', () => {
  const c = new Crafting();
  c.slots[0] = stack('planks', 15);
  assert.equal(c.fill(recipe('crafting_table'), true), true);
  assert.equal(c.grid[0]!.count, 3);
  assert.equal(c.slots[0]!.count, 3);
  assert.equal(c.craft(true), 3);
  assert.equal(c.grid.filter(Boolean).length, 0);
  assert.equal(c.slots.reduce((n, s) => n + (s?.id === itemId('crafting_table') ? s.count : 0), 0), 3);
});

test('autofill and crafting work for every recipe using exactly its ingredients', () => {
  for (const r of RECIPES) {
    const c = new Crafting(); c.setSize(3);
    for (const ingredient of r.ingredients) if (ingredient) insert(c.slots, { id: ingredient[0], count: 1 });
    assert.equal(c.canFill(r), true, r.id);
    assert.equal(c.fill(r), true, r.id);
    assert.deepEqual(c.result?.result, r.result, r.id);
    assert.equal(c.craft(), r.result.count, r.id);
    assert.deepEqual(c.cursor, r.result, r.id);
    assert.ok(c.grid.every(s => s === null), r.id);
    assert.ok(c.slots.every(s => s === null), r.id);
  }
});

test('return-on-close and resizing never delete items or overflow stacks', () => {
  const c = new Crafting();
  c.grid[0] = stack('log', 32); c.cursor = stack('log', 40);
  assert.equal(c.returnAll(), true);
  assert.deepEqual(c.slots.slice(0, 2), [stack('log', 64), stack('log', 8)]);
  c.slots = Array.from({ length: 36 }, () => stack('stone', 64));
  c.grid[0] = stack('log'); c.cursor = stack('planks');
  const before = snapshot(c);
  assert.equal(c.returnAll(), false);
  assert.equal(c.setSize(3), false);
  assert.equal(snapshot(c), before);
  assert.equal(c.size, 2);
});

test('crafting, mining and survival use one inventory, with no stale resource map', () => {
  const c = new Crafting(), s = new Survival(c);
  s.collect(LOG);
  assert.equal(s.count(LOG), 1);
  c.fill(recipe('planks')); c.craft(true);
  assert.equal(s.count(LOG), 0);
  assert.equal(s.count(PLANKS), 4);
  c.fill(recipe('crafting_table')); c.craft(true);
  assert.equal(s.count(PLANKS), 0);
  assert.equal(s.count(itemId('crafting_table')), 1);
  assert.equal(s.consumeBlock(itemId('crafting_table')), true);
  assert.equal(s.count(itemId('crafting_table')), 0);
  c.slots = Array.from({ length: 36 }, () => stack('stone', 64));
  const before = copySlots(c.slots);
  assert.equal(s.collect(LOG), 0);
  assert.deepEqual(c.slots, before);
});
