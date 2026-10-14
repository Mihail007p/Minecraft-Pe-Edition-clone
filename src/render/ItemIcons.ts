import { ITEM_BY_ID } from '../crafting/Items.ts';
import { blockIconURL } from './BlockIcons.ts';

const cache = new Map<number, string>();
/** Собственные пиксельные силуэты, не ассеты Mojang. */
export function itemIconURL(id: number): string {
  const item = ITEM_BY_ID.get(id);
  if (!item) return '';
  if (item.blockId !== undefined) return blockIconURL(item.blockId);
  const cached = cache.get(id);
  if (cached) return cached;
  const key = item.key;
  let shape = '<path d="M5 3h6v2h2v7h-2v2H5v-2H3V5h2z"/>';
  let handle = '';
  const tool = key.split('_').at(-1)!;
  if (['pickaxe', 'axe', 'shovel', 'hoe', 'sword'].includes(tool)) {
    handle = '<path fill="#8c6335" d="M7 6h2v8H7z"/>';
    const paths: Record<string, string> = {
      pickaxe: 'M2 2h11v2h1v4h-2V5H9V4H2z', axe: 'M3 2h7v5H3z',
      shovel: 'M5 2h6v4H9v1H7V6H5z', hoe: 'M3 2h9v5h-2V4H3z',
      sword: 'M7 1h2v7h3v2H4V8h3z',
    };
    shape = `<path d="${paths[tool]}"/>`;
  } else if (key.endsWith('helmet')) shape = '<path d="M3 3h10v8h-3V7H6v4H3z"/>';
  else if (key.endsWith('chestplate')) shape = '<path d="M2 3h4v2h4V3h4v5h-2v6H4V8H2z"/>';
  else if (key.endsWith('leggings')) shape = '<path d="M4 2h8v12H9V7H7v7H4z"/>';
  else if (key.endsWith('boots')) shape = '<path d="M4 5h3v8H2v-3h2zm5 0h3v5h2v3H9z"/>';
  else if (key === 'stick' || key === 'bone' || key === 'sugar_cane') shape = '<path d="M10 2h3v3h-2v3H9v3H7v3H4v-3h2V8h2V5h2z"/>';
  else if (key.endsWith('ingot') || key === 'brick') shape = '<path d="M4 5h9v5l-2 2H2V8z"/><path fill="#fff" opacity=".4" d="M4 5h9l-2 3H2z"/>';
  else if (key === 'paper' || key === 'book') shape = '<path d="M3 2h10v12H3z"/><path stroke="#ede8da" d="M5 4h6M5 6h6M5 8h6M5 10h6"/>';
  else if (key === 'bucket' || key === 'bowl') shape = '<path d="M2 6h12l-2 7H4z"/><path fill="#555" d="M4 6h8v2H4z"/>';
  else if (key === 'bow' || key === 'fishing_rod') shape = '<path d="M4 1h3v2h2v2h2v6H9v2H7v2H4v-2h2v-2h2V5H6V3H4z"/><path stroke="#eee" fill="none" d="M4 2v12"/>';
  else if (key === 'compass' || key === 'clock') shape = '<path d="M4 2h8v2h2v8h-2v2H4v-2H2V4h2z"/><path fill="#34495e" d="M5 4h6v8H5z"/><path fill="#d83b30" d="M8 3v5h3v2H6V8z"/>';
  else if (key === 'diamond' || key === 'emerald' || key === 'quartz') shape = '<path d="M4 2h8l2 4-6 8L2 6z"/><path fill="#fff" opacity=".5" d="M4 3h4L5 7H3z"/>';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><g stroke="#302c29" stroke-width=".7" fill="${item.color}">${handle}${shape}</g></svg>`;
  const url = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  cache.set(id, url);
  return url;
}
