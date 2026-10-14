import { itemId, type Slot, type Stack } from './Items.ts';

export interface Recipe {
  id: string;
  width: number;
  height: number;
  /** null — обязательная пустая ячейка; массив — допустимые заменители. */
  ingredients: (readonly number[] | null)[];
  shapeless: boolean;
  result: Stack;
}
const recipes: Recipe[] = [];
function shaped(id: string, pattern: string[], keys: Record<string, string | string[]>, result: string, count = 1): void {
  recipes.push({ id, width: pattern[0].length, height: pattern.length, shapeless: false,
    ingredients: pattern.join('').split('').map(c => c === ' ' ? null : [keys[c]].flat().map(itemId)),
    result: { id: itemId(result), count } });
}
function shapeless(id: string, ingredients: string[], result: string, count = 1): void {
  recipes.push({ id, width: 0, height: 0, shapeless: true,
    ingredients: ingredients.map(key => [itemId(key)]), result: { id: itemId(result), count } });
}
shapeless('planks', ['log'], 'planks', 4);
shaped('sticks', ['P', 'P'], { P: 'planks' }, 'stick', 4);
shaped('crafting_table', ['PP', 'PP'], { P: 'planks' }, 'crafting_table');
shaped('chest', ['PPP', 'P P', 'PPP'], { P: 'planks' }, 'chest');
shaped('furnace', ['CCC', 'C C', 'CCC'], { C: 'cobblestone' }, 'furnace');
shaped('stone_bricks', ['SS', 'SS'], { S: 'stone' }, 'stone_bricks', 4);
shaped('sandstone', ['SS', 'SS'], { S: 'sand' }, 'sandstone');
shaped('bricks', ['BB', 'BB'], { B: 'brick' }, 'bricks');
shaped('clay', ['CC', 'CC'], { C: 'clay_ball' }, 'clay');
shaped('snow', ['SS', 'SS'], { S: 'snowball' }, 'snow');
shaped('glowstone', ['DD', 'DD'], { D: 'glowstone_dust' }, 'glowstone');
shaped('wool_white', ['SS', 'SS'], { S: 'string' }, 'wool_white');
shaped('bookshelf', ['PPP', 'BBB', 'PPP'], { P: 'planks', B: 'book' }, 'bookshelf');
shaped('tnt', ['GSG', 'SGS', 'GSG'], { G: 'gunpowder', S: 'sand' }, 'tnt');
shaped('paper', ['SSS'], { S: 'sugar_cane' }, 'paper', 3);
shapeless('sugar', ['sugar_cane'], 'sugar');
shapeless('book', ['paper', 'paper', 'paper', 'leather'], 'book');
shaped('bread', ['WWW'], { W: 'wheat' }, 'bread');
shaped('bowl', ['P P', ' P '], { P: 'planks' }, 'bowl', 4);
shaped('arrow', ['F', 'S', 'P'], { F: 'flint', S: 'stick', P: 'feather' }, 'arrow', 4);
shapeless('bone_meal', ['bone'], 'bone_meal', 3);

for (const [material, ingredient] of [
  ['wooden', 'planks'], ['stone', 'cobblestone'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond'],
]) {
  for (const [tool, pattern] of Object.entries({
    pickaxe: ['MMM', ' S ', ' S '], axe: ['MM', 'MS', ' S'],
    shovel: ['M', 'S', 'S'], hoe: ['MM', ' S', ' S'], sword: ['M', 'M', 'S'],
  })) shaped(`${material}_${tool}`, pattern, { M: ingredient, S: 'stick' }, `${material}_${tool}`);
}
for (const [material, ingredient] of [
  ['leather', 'leather'], ['iron', 'iron_ingot'], ['golden', 'gold_ingot'], ['diamond', 'diamond'],
]) {
  for (const [armor, pattern] of Object.entries({
    helmet: ['MMM', 'M M'], chestplate: ['M M', 'MMM', 'MMM'],
    leggings: ['MMM', 'M M', 'M M'], boots: ['M M', 'M M'],
  })) shaped(`${material}_${armor}`, pattern, { M: ingredient }, `${material}_${armor}`);
}
shaped('shears', [' I', 'I '], { I: 'iron_ingot' }, 'shears');
shapeless('flint_and_steel', ['iron_ingot', 'flint'], 'flint_and_steel');
shaped('bucket', ['I I', ' I '], { I: 'iron_ingot' }, 'bucket');
shaped('bow', [' ST', 'S T', ' ST'], { S: 'stick', T: 'string' }, 'bow');
shaped('fishing_rod', ['  S', ' ST', 'S T'], { S: 'stick', T: 'string' }, 'fishing_rod');
shaped('compass', [' I ', 'IRI', ' I '], { I: 'iron_ingot', R: 'redstone' }, 'compass');
shaped('clock', [' G ', 'GRG', ' G '], { G: 'gold_ingot', R: 'redstone' }, 'clock');
for (const [block, ingredient] of [
  ['coal_block', 'coal'], ['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'],
  ['diamond_block', 'diamond'], ['emerald_block', 'emerald'], ['redstone_block', 'redstone'], ['lapis_block', 'lapis_lazuli'],
]) {
  shaped(block, ['MMM', 'MMM', 'MMM'], { M: ingredient }, block);
  shapeless(`${block}_unpack`, [block], ingredient, 9);
}
shaped('quartz_block', ['QQ', 'QQ'], { Q: 'quartz' }, 'quartz_block');
for (const metal of ['iron', 'gold']) {
  shaped(`${metal}_ingot`, ['NNN', 'NNN', 'NNN'], { N: `${metal}_nugget` }, `${metal}_ingot`);
  shapeless(`${metal}_nugget`, [`${metal}_ingot`], `${metal}_nugget`, 9);
}
for (const [color, source] of [['red', 'poppy'], ['yellow', 'dandelion'], ['white', 'bone_meal'], ['blue', 'lapis_lazuli'], ['black', 'ink_sac']]) {
  shapeless(`${color}_dye`, [source], `${color}_dye`);
}
for (const [color, a, b] of [
  ['orange', 'red', 'yellow'], ['lime', 'green', 'white'], ['cyan', 'blue', 'green'],
  ['purple', 'red', 'blue'], ['pink', 'red', 'white'], ['gray', 'black', 'white'],
]) shapeless(`${color}_dye`, [`${a}_dye`, `${b}_dye`], `${color}_dye`, 2);
for (const color of ['white', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray', 'black']) {
  // В Bedrock окрашивается в том числе уже окрашенная шерсть.
  const wool = ['white', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'blue', 'purple', 'pink', 'gray', 'black'].map(c => itemId(`wool_${c}`));
  recipes.push({ id: `wool_${color}`, width: 0, height: 0, shapeless: true,
    ingredients: [wool, [itemId(`${color}_dye`)]], result: { id: itemId(`wool_${color}`), count: 1 } });
}
export const RECIPES: readonly Recipe[] = recipes;

export function fits(recipe: Recipe, size: number): boolean {
  return recipe.shapeless ? recipe.ingredients.length <= size * size : recipe.width <= size && recipe.height <= size;
}
/** Возвращает индексы расходуемых ячеек. Сдвиги и горизонтальное отражение разрешены; поворот — нет. */
export function matchRecipe(recipe: Recipe, grid: readonly Slot[], size: number): number[] | null {
  if (!fits(recipe, size) || grid.length !== size * size) return null;
  const occupied = grid.flatMap((s, i) => s && s.count > 0 ? [i] : []);
  if (occupied.length !== recipe.ingredients.filter(Boolean).length) return null;
  if (recipe.shapeless) {
    // Backtracking нужен для пересекающихся групп заменителей.
    const assign = (n: number, used: number[]): number[] | null => {
      if (n === recipe.ingredients.length) return used;
      for (const i of occupied) {
        if (!used.includes(i) && recipe.ingredients[n]!.includes(grid[i]!.id)) {
          const result = assign(n + 1, [...used, i]);
          if (result) return result;
        }
      }
      return null;
    };
    return assign(0, []);
  }
  for (let y = 0; y <= size - recipe.height; y++) for (let x = 0; x <= size - recipe.width; x++) {
    for (const mirror of [false, true]) {
      const used: number[] = [];
      let valid = true;
      for (let ry = 0; ry < recipe.height; ry++) for (let rx = 0; rx < recipe.width; rx++) {
        const ingredient = recipe.ingredients[ry * recipe.width + (mirror ? recipe.width - 1 - rx : rx)];
        const i = (y + ry) * size + x + rx;
        if (ingredient) {
          if (!grid[i] || !ingredient.includes(grid[i]!.id)) valid = false;
          used.push(i);
        } else if (grid[i]) valid = false;
      }
      if (valid) return used;
    }
  }
  return null;
}
export function findRecipe(grid: readonly Slot[], size: number): Recipe | undefined {
  return RECIPES.find(recipe => matchRecipe(recipe, grid, size) !== null);
}
