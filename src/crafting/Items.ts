import { BLOCKS } from '../world/Blocks.ts';

export type Category = 'building' | 'equipment' | 'materials';
export interface ItemDef {
  id: number;
  key: string;
  name: string;
  maxStack: number;
  category: Category;
  blockId?: number;
  color?: string;
}

// Предметы не записываются в Uint8Array мира. Старые ID блоков не меняются.
// Служебные блоки (текущая вода, воздух) предметами не становятся.
export const ITEMS: ItemDef[] = BLOCKS.filter(b => b.inCreative).map(b => ({
  id: b.id, key: b.key, name: b.name, maxStack: 64, category: 'building', blockId: b.id,
}));
let nextId = 256;
function item(key: string, name: string, color = '#bda581', maxStack = 64, category: Category = 'materials'): void {
  ITEMS.push({ id: nextId++, key, name, maxStack, category, color });
}
for (const [key, name, color] of [
  ['stick', 'Палка', '#916432'], ['coal', 'Уголь', '#353535'], ['charcoal', 'Древесный уголь', '#45403c'],
  ['iron_ingot', 'Железный слиток', '#d8d8d8'], ['gold_ingot', 'Золотой слиток', '#f4ce3f'],
  ['iron_nugget', 'Кусочек железа', '#d8d8d8'], ['gold_nugget', 'Кусочек золота', '#f4ce3f'],
  ['diamond', 'Алмаз', '#4ee3d4'], ['redstone', 'Редстоуновая пыль', '#c73326'],
  ['lapis_lazuli', 'Лазурит', '#385ed4'], ['emerald', 'Изумруд', '#35d66b'],
  ['quartz', 'Кварц', '#eee2d5'], ['string', 'Нить', '#eaeaea'], ['leather', 'Кожа', '#986038'],
  ['paper', 'Бумага', '#eee9d9'], ['book', 'Книга', '#986038'], ['sugar_cane', 'Сахарный тростник', '#95bb58'],
  ['sugar', 'Сахар', '#eeeeee'], ['wheat', 'Пшеница', '#d9ba4e'], ['bread', 'Хлеб', '#bb8637'],
  ['bowl', 'Миска', '#8c6137'], ['brick', 'Кирпич', '#b96547'], ['clay_ball', 'Комок глины', '#a1a9b8'],
  ['snowball', 'Снежок', '#edfaff'], ['glowstone_dust', 'Светокаменная пыль', '#efd77c'],
  ['gunpowder', 'Порох', '#666666'], ['flint', 'Кремень', '#444444'], ['feather', 'Перо', '#eeeeee'],
  ['bone', 'Кость', '#eee9d9'], ['bone_meal', 'Костная мука', '#eee9d9'],
  ['red_dye', 'Красный краситель', '#ba322a'], ['yellow_dye', 'Жёлтый краситель', '#eac936'],
  ['orange_dye', 'Оранжевый краситель', '#ed8737'], ['white_dye', 'Белый краситель', '#eeeeee'],
  ['blue_dye', 'Синий краситель', '#3454bf'], ['black_dye', 'Чёрный краситель', '#333333'],
  ['green_dye', 'Зелёный краситель', '#4e7733'], ['lime_dye', 'Лаймовый краситель', '#8cbf36'],
  ['cyan_dye', 'Бирюзовый краситель', '#259a9e'], ['purple_dye', 'Фиолетовый краситель', '#843faf'],
  ['pink_dye', 'Розовый краситель', '#e394ad'], ['gray_dye', 'Серый краситель', '#646464'],
  ['ink_sac', 'Чернильный мешок', '#333333'], ['arrow', 'Стрела', '#c5c5c5'],
] as const) item(key, name, color, key === 'snowball' ? 16 : 64);

for (const [material, name, color] of [
  ['wooden', 'Деревянн', '#a77e42'], ['stone', 'Каменн', '#929292'],
  ['iron', 'Железн', '#dddddd'], ['golden', 'Золот', '#efcb3c'], ['diamond', 'Алмазн', '#4ee3d4'],
] as const) {
  for (const [tool, suffix] of [['pickaxe', 'ая кирка'], ['axe', 'ый топор'], ['shovel', 'ая лопата'], ['hoe', 'ая мотыга'], ['sword', 'ый меч']] as const) {
    item(`${material}_${tool}`, name + suffix, color, 1, 'equipment');
  }
}
for (const [material, name, color] of [
  ['leather', 'Кожан', '#986038'], ['iron', 'Железн', '#dddddd'],
  ['golden', 'Золот', '#efcb3c'], ['diamond', 'Алмазн', '#4ee3d4'],
] as const) {
  for (const [armor, suffix] of [['helmet', 'ый шлем'], ['chestplate', 'ый нагрудник'], ['leggings', 'ые поножи'], ['boots', 'ые ботинки']] as const) {
    item(`${material}_${armor}`, name + suffix, color, 1, 'equipment');
  }
}
item('shears', 'Ножницы', '#dddddd', 1, 'equipment');
item('flint_and_steel', 'Огниво', '#999999', 1, 'equipment');
item('bow', 'Лук', '#916432', 1, 'equipment');
item('fishing_rod', 'Удочка', '#916432', 1, 'equipment');
item('bucket', 'Ведро', '#cccccc', 16, 'equipment');
item('compass', 'Компас', '#c5c5c5', 64, 'equipment');
item('clock', 'Часы', '#e4c84f', 64, 'equipment');

export const ITEM_BY_ID = new Map(ITEMS.map(i => [i.id, i]));
export const ITEM_BY_KEY = new Map(ITEMS.map(i => [i.key, i]));
export function itemId(key: string): number {
  const def = ITEM_BY_KEY.get(key);
  if (!def) throw new Error(`Неизвестный предмет: ${key}`);
  return def.id;
}
export interface Stack { id: number; count: number }
export type Slot = Stack | null;
export function copySlots(slots: readonly Slot[]): Slot[] {
  return slots.map(s => s ? { ...s } : null);
}
/** Добавляет сколько поместится, возвращает остаток. */
export function insert(slots: Slot[], stack: Stack): number {
  let left = stack.count;
  const max = ITEM_BY_ID.get(stack.id)!.maxStack;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const slot = slots[i];
    if (slot?.id === stack.id) {
      const n = Math.min(max - slot.count, left);
      slot.count += n;
      left -= n;
    }
  }
  for (let i = 0; i < slots.length && left > 0; i++) {
    if (!slots[i]) {
      const n = Math.min(max, left);
      slots[i] = { id: stack.id, count: n };
      left -= n;
    }
  }
  return left;
}
