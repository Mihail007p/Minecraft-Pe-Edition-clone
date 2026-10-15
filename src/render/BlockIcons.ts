import { BLOCKS, FACE_NX, FACE_PY, FACE_PZ, faceTexture, type BlockDef } from '../world/Blocks.ts';
import { TEX_SIZE, getTexturePixels } from './textures.ts';

const tileCache = new Map<string, HTMLCanvasElement>();
const iconCache = new Map<number, string>();

/** Канвас 16×16 с пикселями текстуры и множителем яркости (прозрачность пикселей сохраняется). */
function tileCanvas(name: string, brightness = 1): HTMLCanvasElement {
  const key = `${name}:${brightness}`;
  let canvas = tileCache.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const src = getTexturePixels(name);
  for (let i = 0; i < src.length; i += 4) {
    img.data[i] = Math.round(src[i] * brightness);
    img.data[i + 1] = Math.round(src[i + 1] * brightness);
    img.data[i + 2] = Math.round(src[i + 2] * brightness);
    img.data[i + 3] = src[i + 3];
  }
  ctx.putImageData(img, 0, 0);
  tileCache.set(key, canvas);
  return canvas;
}

export const ICON_SIZE = 64;

/**
 * Изометрическая иконка блока (как в инвентаре): верхняя, левая и правая грани.
 * Возвращает data URL; результат кэшируется.
 */
export function blockIconURL(id: number): string {
  const cached = iconCache.get(id);
  if (cached) return cached;
  const def = BLOCKS[id];
  const canvas = document.createElement('canvas');
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  if (def.shape === 'cross') {
    ctx.drawImage(tileCanvas(faceTexture(def, FACE_PY)), 4, 4, ICON_SIZE - 8, ICON_SIZE - 8);
  } else {
    drawCube(ctx, def, ICON_SIZE);
  }
  const url = canvas.toDataURL();
  iconCache.set(id, url);
  return url;
}

function drawCube(ctx: CanvasRenderingContext2D, def: BlockDef, size: number): void {
  const W = size - 4; // ширина куба; высота = W
  const H = W / 2; // высота боковых граней
  const ox = 2;
  const oy = 2;
  const top = tileCanvas(faceTexture(def, FACE_PY), 1);
  const left = tileCanvas(faceTexture(def, FACE_NX), 0.78);
  const right = tileCanvas(faceTexture(def, FACE_PZ), 0.6);
  const liquidScale = def.shape === 'liquid' ? 0.875 : 1;

  const draw = (img: HTMLCanvasElement, a: number, b: number, c: number, d: number, e: number, f: number) => {
    ctx.setTransform(a, b, c, d, e + ox, f + oy);
    ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE, 0, 0, 1, 1);
  };
  const topShift = (1 - liquidScale) * H;
  // Верхняя грань: ромб
  draw(top, W / 2, W / 4, -W / 2, W / 4, W / 2, topShift);
  // Левая грань
  draw(left, W / 2, W / 4, 0, H * liquidScale, 0, W / 4 + topShift);
  // Правая грань
  draw(right, W / 2, -W / 4, 0, H * liquidScale, W / 2, W / 2 + topShift);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
