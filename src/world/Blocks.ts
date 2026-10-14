// Реестр блоков. Идентификаторы хранятся в Uint8Array чанков, поэтому их не более 255.

export type BlockShape = 'cube' | 'cross' | 'liquid';
export type RenderPass = 'opaque' | 'cutout' | 'water';

export interface BlockDef {
  id: number;
  /** Ключ для кода/сохранений. */
  key: string;
  /** Название для интерфейса. */
  name: string;
  /** Текстуры граней (имена из реестра текстур). */
  textures: { all?: string; top?: string; bottom?: string; side?: string };
  /** Есть ли коллизия с игроком. */
  solid: boolean;
  /** Непрозрачный полный куб — отсекает грани соседей и блокирует свет. */
  opaque: boolean;
  shape: BlockShape;
  renderPass: RenderPass;
  breakable: boolean;
  /** Показывать ли в креативном инвентаре. */
  inCreative: boolean;
  /** Не рисовать грани между двумя одинаковыми блоками (стекло, вода, листва — нет). */
  cullSame: boolean;
  /** Можно ли заменить этот блок при установке другого (воздух, вода, трава). */
  replaceable: boolean;
}

/** Порядок граней: +X, -X, +Y, -Y, +Z, -Z. */
export const FACE_PX = 0;
export const FACE_NX = 1;
export const FACE_PY = 2;
export const FACE_NY = 3;
export const FACE_PZ = 4;
export const FACE_NZ = 5;

type BlockInput = Omit<BlockDef, 'id' | 'solid' | 'opaque' | 'shape' | 'renderPass' | 'breakable' | 'inCreative' | 'cullSame' | 'replaceable'> &
  Partial<Pick<BlockDef, 'solid' | 'opaque' | 'shape' | 'renderPass' | 'breakable' | 'inCreative' | 'cullSame' | 'replaceable'>>;

const defs: BlockDef[] = [];

function define(input: BlockInput): number {
  const id = defs.length;
  if (id > 255) throw new Error('Слишком много типов блоков (максимум 256)');
  defs.push({
    id,
    solid: true,
    opaque: true,
    shape: 'cube',
    renderPass: 'opaque',
    breakable: true,
    inCreative: true,
    cullSame: false,
    replaceable: false,
    ...input,
  });
  return id;
}

export const AIR = define({
  key: 'air', name: 'Воздух', textures: {},
  solid: false, opaque: false, breakable: false, inCreative: false, replaceable: true,
});
export const STONE = define({ key: 'stone', name: 'Камень', textures: { all: 'stone' } });
export const GRASS = define({ key: 'grass', name: 'Дёрн', textures: { top: 'grass_top', side: 'grass_side', bottom: 'dirt' } });
export const DIRT = define({ key: 'dirt', name: 'Земля', textures: { all: 'dirt' } });
export const COBBLESTONE = define({ key: 'cobblestone', name: 'Булыжник', textures: { all: 'cobblestone' } });
export const PLANKS = define({ key: 'planks', name: 'Дубовые доски', textures: { all: 'planks' } });
export const BEDROCK = define({ key: 'bedrock', name: 'Коренная порода', textures: { all: 'bedrock' }, breakable: false });
export const SAND = define({ key: 'sand', name: 'Песок', textures: { all: 'sand' } });
export const GRAVEL = define({ key: 'gravel', name: 'Гравий', textures: { all: 'gravel' } });
export const LOG = define({ key: 'log', name: 'Дубовое бревно', textures: { side: 'log_side', top: 'log_top', bottom: 'log_top' } });
export const LEAVES = define({
  key: 'leaves', name: 'Дубовая листва', textures: { all: 'leaves' },
  opaque: false, renderPass: 'cutout',
});
export const GLASS = define({
  key: 'glass', name: 'Стекло', textures: { all: 'glass' },
  opaque: false, renderPass: 'cutout', cullSame: true,
});
export const WATER = define({
  key: 'water', name: 'Вода', textures: { all: 'water' },
  solid: false, opaque: false, shape: 'liquid', renderPass: 'water', cullSame: true, replaceable: true,
});
export const SNOW_GRASS = define({ key: 'snow_grass', name: 'Заснеженный дёрн', textures: { top: 'snow', side: 'snow_grass_side', bottom: 'dirt' } });
export const SNOW = define({ key: 'snow', name: 'Снежный блок', textures: { all: 'snow' } });
export const COAL_ORE = define({ key: 'coal_ore', name: 'Угольная руда', textures: { all: 'coal_ore' } });
export const IRON_ORE = define({ key: 'iron_ore', name: 'Железная руда', textures: { all: 'iron_ore' } });
export const BRICKS = define({ key: 'bricks', name: 'Кирпичи', textures: { all: 'bricks' } });
export const STONE_BRICKS = define({ key: 'stone_bricks', name: 'Каменные кирпичи', textures: { all: 'stone_bricks' } });
export const SANDSTONE = define({ key: 'sandstone', name: 'Песчаник', textures: { side: 'sandstone_side', top: 'sandstone_top', bottom: 'sandstone_top' } });
export const CACTUS = define({ key: 'cactus', name: 'Кактус', textures: { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_top' }, opaque: false, renderPass: 'cutout' });
export const TALL_GRASS = define({
  key: 'tall_grass', name: 'Трава', textures: { all: 'tall_grass' },
  solid: false, opaque: false, shape: 'cross', renderPass: 'cutout', replaceable: true,
});
export const DANDELION = define({
  key: 'dandelion', name: 'Одуванчик', textures: { all: 'dandelion' },
  solid: false, opaque: false, shape: 'cross', renderPass: 'cutout',
});
export const POPPY = define({
  key: 'poppy', name: 'Мак', textures: { all: 'poppy' },
  solid: false, opaque: false, shape: 'cross', renderPass: 'cutout',
});
export const OAK_SAPLING = define({
  key: 'sapling', name: 'Саженец дуба', textures: { all: 'sapling' },
  solid: false, opaque: false, shape: 'cross', renderPass: 'cutout',
});
export const GLOWSTONE = define({ key: 'glowstone', name: 'Светокамень', textures: { all: 'glowstone' } });
export const OBSIDIAN = define({ key: 'obsidian', name: 'Обсидиан', textures: { all: 'obsidian' } });
export const BOOKSHELF = define({ key: 'bookshelf', name: 'Книжный шкаф', textures: { side: 'bookshelf', top: 'planks', bottom: 'planks' } });
export const CRAFTING_TABLE = define({ key: 'crafting_table', name: 'Верстак', textures: { side: 'crafting_table_side', top: 'crafting_table_top', bottom: 'planks' } });
export const TNT = define({ key: 'tnt', name: 'Динамит', textures: { side: 'tnt_side', top: 'tnt_top', bottom: 'tnt_bottom' } });
export const WOOL_WHITE = define({ key: 'wool_white', name: 'Белая шерсть', textures: { all: 'wool_white' } });
export const WOOL_RED = define({ key: 'wool_red', name: 'Красная шерсть', textures: { all: 'wool_red' } });
export const WOOL_ORANGE = define({ key: 'wool_orange', name: 'Оранжевая шерсть', textures: { all: 'wool_orange' } });
export const WOOL_YELLOW = define({ key: 'wool_yellow', name: 'Жёлтая шерсть', textures: { all: 'wool_yellow' } });
export const WOOL_LIME = define({ key: 'wool_lime', name: 'Лаймовая шерсть', textures: { all: 'wool_lime' } });
export const WOOL_GREEN = define({ key: 'wool_green', name: 'Зелёная шерсть', textures: { all: 'wool_green' } });
export const WOOL_CYAN = define({ key: 'wool_cyan', name: 'Бирюзовая шерсть', textures: { all: 'wool_cyan' } });
export const WOOL_BLUE = define({ key: 'wool_blue', name: 'Синяя шерсть', textures: { all: 'wool_blue' } });
export const WOOL_PURPLE = define({ key: 'wool_purple', name: 'Фиолетовая шерсть', textures: { all: 'wool_purple' } });
export const WOOL_PINK = define({ key: 'wool_pink', name: 'Розовая шерсть', textures: { all: 'wool_pink' } });
export const WOOL_GRAY = define({ key: 'wool_gray', name: 'Серая шерсть', textures: { all: 'wool_gray' } });
export const WOOL_BLACK = define({ key: 'wool_black', name: 'Чёрная шерсть', textures: { all: 'wool_black' } });

// Новые ID добавляем только в конец реестра, сохраняя ID существующих блоков.
export const CLAY = define({ key: 'clay', name: 'Глина', textures: { all: 'clay' } });
export const COAL_BLOCK = define({ key: 'coal_block', name: 'Угольный блок', textures: { all: 'coal_block' } });
export const IRON_BLOCK = define({ key: 'iron_block', name: 'Железный блок', textures: { all: 'iron_block' } });
export const GOLD_BLOCK = define({ key: 'gold_block', name: 'Золотой блок', textures: { all: 'gold_block' } });
export const DIAMOND_BLOCK = define({ key: 'diamond_block', name: 'Алмазный блок', textures: { all: 'diamond_block' } });
export const EMERALD_BLOCK = define({ key: 'emerald_block', name: 'Изумрудный блок', textures: { all: 'emerald_block' } });
export const REDSTONE_BLOCK = define({ key: 'redstone_block', name: 'Редстоуновый блок', textures: { all: 'redstone_block' } });
export const LAPIS_BLOCK = define({ key: 'lapis_block', name: 'Лазуритовый блок', textures: { all: 'lapis_block' } });
export const QUARTZ_BLOCK = define({ key: 'quartz_block', name: 'Кварцевый блок', textures: { all: 'quartz_block' } });

export const CHEST = define({ key: 'chest', name: 'Сундук', textures: { all: 'chest' } });
export const FURNACE = define({ key: 'furnace', name: 'Печь', textures: { side: 'furnace_side', top: 'stone', bottom: 'stone' } });

export const BLOCKS: readonly BlockDef[] = defs;

/** Быстрые таблицы свойств (индекс — id блока) для горячих циклов мешера/физики. */
export const BLOCK_SOLID = new Uint8Array(256);
export const BLOCK_OPAQUE = new Uint8Array(256);
export const BLOCK_REPLACEABLE = new Uint8Array(256);
for (const b of defs) {
  BLOCK_SOLID[b.id] = b.solid ? 1 : 0;
  BLOCK_OPAQUE[b.id] = b.opaque ? 1 : 0;
  BLOCK_REPLACEABLE[b.id] = b.replaceable ? 1 : 0;
}

/** Имя текстуры для заданной грани блока. */
export function faceTexture(def: BlockDef, face: number): string {
  const t = def.textures;
  if (face === FACE_PY) return t.top ?? t.all ?? 'missing';
  if (face === FACE_NY) return t.bottom ?? t.side ?? t.all ?? 'missing';
  return t.side ?? t.all ?? 'missing';
}

export function blockByKey(key: string): BlockDef | undefined {
  return defs.find((d) => d.key === key);
}

/** Блоки, доступные в креативном инвентаре (в порядке объявления). */
export const CREATIVE_BLOCKS: readonly BlockDef[] = defs.filter((d) => d.inCreative);

/** Стартовый набор хотбара. */
export const DEFAULT_HOTBAR: readonly number[] = [
  GRASS, DIRT, STONE, COBBLESTONE, PLANKS, LOG, LEAVES, GLASS, SAND,
];
