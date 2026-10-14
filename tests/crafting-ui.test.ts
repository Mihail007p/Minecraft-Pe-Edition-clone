import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';
import { Crafting } from '../src/crafting/Crafting.ts';
import { itemId } from '../src/crafting/Items.ts';
import type { World } from '../src/world/World.ts';
import type { Player } from '../src/player/Player.ts';
import type { Survival } from '../src/player/Survival.ts';
import type { Animals } from '../src/entities/Animals.ts';

test('inventory UI: search, filters, touch-sized controls, split, craft, close and keyboard focus', async () => {
  const browser = createFakeBrowser();
  try {
    const { Inventory } = await import('../src/ui/Inventory.ts');
    const c = new Crafting();
    c.slots[0] = { id: itemId('log'), count: 3 };
    const ui = new Inventory(document.getElementById('app')!, c);
    let changes = 0;
    ui.onChange = () => changes++;
    ui.onClose = () => { ui.close(); };
    ui.open(false, 'survival');
    const click = (selector: string) => (ui.root.querySelector(selector) as HTMLButtonElement).click();
    assert.equal(ui.root.querySelectorAll('.inv-cell').length, 0);
    assert.equal(ui.root.querySelectorAll('.craft-grid button').length, 4);
    assert.equal(ui.root.querySelectorAll('.bag-grid button').length, 36);
    click('[data-recipe="planks"]');
    assert.equal(c.result?.id, 'planks');
    click('.craft-output');
    assert.deepEqual(c.cursor, { id: itemId('planks'), count: 4 });
    click('.split-toggle');
    click('[data-area="slots"][data-index="1"]');
    assert.equal(c.slots[1]!.count, 1);
    assert.equal(c.cursor!.count, 3);
    const search = ui.root.querySelector<HTMLInputElement>('.recipe-search')!;
    search.value = 'кирка'; search.dispatchEvent(new browser.window.Event('input', { bubbles: true }));
    assert.equal(ui.root.querySelectorAll('.recipe-card').length, 5);
    click('[data-recipe="wooden_pickaxe"]');
    assert.match(ui.root.querySelector('.craft-status')!.textContent!, /верстак/i);
    assert.ok(ui.root.querySelector('.recipe-pattern'));
    search.focus();
    search.dispatchEvent(new browser.window.KeyboardEvent('keydown', { code: 'KeyE', bubbles: true }));
    assert.equal(ui.isOpen, true, 'typing E in search must not close it');
    search.dispatchEvent(new browser.window.KeyboardEvent('keydown', { code: 'Escape', bubbles: true }));
    assert.equal(ui.isOpen, false);
    assert.equal(c.cursor, null);
    assert.ok(c.grid.every(s => !s));
    assert.ok(changes >= 3);
    ui.open(true, 'creative');
    assert.equal(ui.root.querySelectorAll('.craft-grid button').length, 9);
    search.value = ''; search.dispatchEvent(new browser.window.Event('input', { bubbles: true }));
    click('.available-filter input');
    assert.ok(ui.root.querySelectorAll('.recipe-card').length > 0);
    assert.equal(ui.root.querySelectorAll('.recipe-card.unavailable').length, 0);
    ui.close();
  } finally { browser.close(); }
});

test('survival: logs → planks → workbench → sticks → pickaxe; no catalogue or world actions in dialog', async () => {
  const browser = createFakeBrowser();
  try {
    const { Game } = await import('../src/core/Game.ts');
    const { Settings } = await import('../src/core/Settings.ts');
    const { LOG, CRAFTING_TABLE, AIR, DIRT } = await import('../src/world/Blocks.ts');
    const { RECIPES } = await import('../src/crafting/Recipes.ts');
    const settings = new Settings(); settings.set('renderDistance', 2);
    const instance = new Game(document.getElementById('app')!, settings);
    const game = instance as unknown as {
      state: string; world: World; player: Player; survival: Survival; crafting: Crafting; animals: Animals;
      hotbar: number[]; selectedSlot: number;
      selectSlot(index: number): void; openInventory(workbench?: boolean): void; closeInventory(): boolean;
      placeBlock(): void; breakBlock(): void;
    };
    instance.startWorld('1', 'survival');
    for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
    assert.equal(game.state, 'playing');
    const c = game.crafting;
    for (let i = 0; i < 3; i++) game.survival.collect(LOG);
    const make = (key: string, max = false) => {
      assert.equal(c.fill(RECIPES.find(r => r.id === key)!, max), true, key);
      assert.ok(c.craft(true) > 0, key);
    };
    game.openInventory();
    make('planks', true); make('crafting_table'); make('sticks');
    assert.equal(game.survival.count(itemId('planks')), 6);
    assert.equal(game.survival.count(itemId('stick')), 4);
    game.closeInventory();
    const p = game.player, x = Math.floor(p.x), z = Math.floor(p.z);
    for (const a of game.animals.animals) { a.x = x + 10; a.z = z + 10; }
    for (let bx = x - 3; bx <= x + 3; bx++) for (let bz = z - 4; bz <= z + 2; bz++) {
      for (let y = 60; y <= 65; y++) game.world.setBlock(bx, y, bz, y === 60 ? DIRT : AIR);
    }
    p.teleport(x + 0.5, 61, z + 0.5); p.yaw = 0; p.pitch = -0.7;
    game.selectSlot(game.hotbar.indexOf(CRAFTING_TABLE));
    game.placeBlock();
    assert.equal(game.survival.count(CRAFTING_TABLE), 0, 'placement consumes crafted block');
    game.placeBlock();
    assert.equal(document.querySelector('.inventory')!.classList.contains('hidden'), false, 'empty hand opens placed table');
    assert.equal(c.size, 3);
    assert.equal(document.querySelectorAll('.craft-grid button').length, 9);
    const stock = JSON.stringify(c.slots);
    game.placeBlock(); game.breakBlock();
    assert.equal(JSON.stringify(c.slots), stock, 'no actions leak through dialog');
    make('wooden_pickaxe');
    assert.equal(game.survival.count(itemId('wooden_pickaxe')), 1);
    assert.equal(game.survival.count(itemId('planks')), 3);
    assert.equal(game.survival.count(itemId('stick')), 2);
    const hunger = game.survival.hunger;
    browser.key('KeyW', true); await browser.frames(3); browser.key('KeyW', false);
    assert.equal(game.survival.hunger, hunger);
    game.closeInventory(); game.openInventory();
    assert.equal(c.size, 2, 'pocket crafting cannot retain table access');
    assert.equal(c.fill(RECIPES.find(r => r.id === 'wooden_pickaxe')!), false);
    game.closeInventory(); instance.dispose();
  } finally { browser.close(); }
});
