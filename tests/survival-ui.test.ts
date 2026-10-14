import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeBrowser } from './helpers/fakeBrowser.ts';
import type { World } from '../src/world/World.ts';
import type { Player } from '../src/player/Player.ts';
import type { Survival } from '../src/player/Survival.ts';
import type { Animals } from '../src/entities/Animals.ts';
import type { RaycastHit } from '../src/world/Raycast.ts';
import type { Animal } from '../src/entities/Animal.ts';

test('survival UI: mode, mining, finite stock, hunting, eating, death and respawn', async () => {
  const browser = createFakeBrowser(), win = browser.window;
  try {
    const { Game } = await import('../src/core/Game.ts');
    const { Settings } = await import('../src/core/Settings.ts');
    const { AIR, DIRT, STONE } = await import('../src/world/Blocks.ts');
    const settings = new Settings(); settings.set('renderDistance', 2);
    const instance = new Game(win.document.getElementById('app')!, settings);
    const game = instance as unknown as {
      state: string; mode: string; world: World; player: Player; survival: Survival;
      animals: Animals; currentHit: RaycastHit; targetAnimal: Animal | null;
      hotbar: number[]; selectedSlot: number; attackCooldown: number;
      breakBlock(): void; placeBlock(): void; updateTarget(): void;
      openInventory(): void; closeInventory(): void; toggleFly(): void;
    };
    (win.document.querySelector('.mc-input') as HTMLInputElement).value = '1';
    assert.equal((win.document.querySelector('.mode-select') as HTMLSelectElement).value, 'survival');
    [...win.document.querySelectorAll('button')].find(b => b.textContent === 'Играть')!.click();
    for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
    assert.equal(game.state, 'playing'); assert.equal(game.mode, 'survival');
    assert.ok(game.hotbar.every(id => id === AIR));
    assert.ok(game.animals.animals.length > 0);
    game.toggleFly(); assert.equal(game.player.flying, false);
    game.openInventory();
    assert.equal(win.document.querySelectorAll('.inv-cell').length, 0, 'no creative catalogue');
    const hunger = game.survival.hunger;
    await browser.frames(30);
    assert.equal(game.survival.hunger, hunger, 'inventory freezes simulation');
    game.closeInventory();

    // A reproducible small clearing in the loaded area, with a mineable dirt floor.
    const p = game.player, x = Math.floor(p.x), z = Math.floor(p.z);
    for (let bx = x - 6; bx <= x + 6; bx++) for (let bz = z - 6; bz <= z + 6; bz++) {
      for (let y = 58; y <= 68; y++) game.world.setBlock(bx, y, bz, y < 60 ? STONE : y === 60 ? DIRT : AIR);
    }
    p.teleport(x + 0.5, 61, z + 0.5); p.yaw = 0; p.pitch = -0.7;
    // Move wildlife out of this ray while testing blocks.
    for (const a of game.animals.animals) { a.x = x + 10; a.z = z + 10; }
    game.updateTarget(); const hit = { ...game.currentHit };
    assert.equal(hit.id, DIRT);
    game.breakBlock(); assert.equal(game.world.getBlock(hit.x, hit.y, hit.z), DIRT);
    game.breakBlock(); game.breakBlock();
    assert.equal(game.world.getBlock(hit.x, hit.y, hit.z), AIR);
    assert.equal(game.survival.count(DIRT), 1); assert.equal(game.hotbar[0], DIRT);
    assert.equal(win.document.querySelector('.slot .item-count')!.textContent, '1');
    game.openInventory();
    assert.equal(win.document.querySelectorAll('.inv-cell').length, 0, 'survival never exposes creative items');
    assert.equal(win.document.querySelectorAll('.bag-grid button img').length, 1, 'mined item is in the shared bag');
    game.closeInventory();
    p.yaw = 0.8; game.updateTarget(); const base = { ...game.currentHit };
    game.placeBlock();
    assert.equal(game.world.getBlock(base.x + base.nx, base.y + base.ny, base.z + base.nz), DIRT);
    assert.equal(game.survival.count(DIRT), 0);
    game.updateTarget(); const next = { ...game.currentHit };
    game.placeBlock();
    assert.equal(game.world.getBlock(next.x + next.nx, next.y + next.ny, next.z + next.nz), AIR, 'cannot duplicate blocks');

    const animal = game.animals.animals[0];
    animal.x = p.x; animal.y = 61; animal.z = p.z - 3;
    p.yaw = 0; p.pitch = Math.atan2(animal.y + 0.6 - p.eyeY, 3);
    game.updateTarget(); assert.equal(game.targetAnimal, animal);
    game.breakBlock(); const hp = animal.health;
    game.breakBlock(); assert.equal(animal.health, hp, 'attack cooldown');
    for (let i = 0; i < 3; i++) { game.attackCooldown = 0; game.breakBlock(); }
    assert.ok(!game.animals.animals.includes(animal)); assert.ok(game.survival.food >= 2);
    game.survival.hunger = 10; await browser.frames(1);
    const food = game.survival.food;
    (win.document.querySelector('.eat-btn') as HTMLButtonElement).click();
    assert.equal(game.survival.food, food - 1); assert.ok(game.survival.hunger > 15);
    browser.key('KeyR', true); browser.key('KeyR', false);
    assert.equal(game.survival.food, food - 2); assert.equal(game.survival.hunger, 20);

    game.survival.damage(100); await browser.frames(2);
    assert.equal(game.state, 'dead');
    assert.ok(!win.document.querySelector('.death-menu')!.classList.contains('hidden'));
    [...win.document.querySelectorAll('button')].find(b => b.textContent === 'Возродиться')!.click();
    for (let i = 0; i < 300 && game.state === 'loading'; i++) await browser.frames(1);
    assert.equal(game.state, 'playing'); assert.equal(game.survival.health, 20);
    assert.equal(game.survival.blocks.size, 0); assert.equal(game.survival.food, 0);
    assert.ok(game.hotbar.every(id => id === AIR));
    instance.quitToMenu();
    instance.startWorld('42', 'creative');
    assert.equal(game.mode, 'creative'); assert.ok(game.hotbar.some(id => id !== AIR));
    instance.dispose();
  } finally { browser.close(); }
});
