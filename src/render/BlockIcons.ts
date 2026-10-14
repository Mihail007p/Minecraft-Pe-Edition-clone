import { BLOCKS, FACE_NX, FACE_PY, FACE_PZ, faceTexture, type BlockDef } from '../world/Blocks.ts';
import { TEX_SIZE, getTexturePixels } from './textures.ts';

const tileCache = new Map<string, HTMLCanvasElement>();
const iconCache = new Map<number, string>();

/** Канвас 16×16 с пикселями текстуры (источник для drawImage). */
function tileCanvas(name: string): HTMLCanvasElement {
  let canvas = tileCache.get(name);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  img.data.set(getTexturePixels(name));
  ctx.putImageData(img, 0, 0);
  tileCache.set(name, canvas);
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
  const top = tileCanvas(faceTexture(def, FACE_PY));
  const left = tileCanvas(faceTexture(def, FACE_NX));
  const right = tileCanvas(faceTexture(def, FACE_PZ));
  const liquidScale = def.shape === 'liquid' ? 0.875 : 1;

  const draw = (img: HTMLCanvasElement, a: number, b: number, c: number, d: number, e: number, f: number, dark: number) => {
    ctx.setTransform(a, b, c, d, e + ox, f + oy);
    ctx.drawImage(img, 0, 0, TEX_SIZE, TEX_SIZE, 0, 0, 1, 1);
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,0,${dark})`;
      ctx.fillRect(0, 0, 1, 1);
    }
  };
  const topShift = (1 - liquidScale) * H;
  // Верхняя грань: ромб
  draw(top, W / 2, W / 4, -W / 2, W / 4, W / 2, topShift, 0);
  // Левая грань
  draw(left, W / 2, W / 4, 0, H * liquidScale, 0, W / 4 + topShift, 0.22);
  // Правая грань
  draw(right, W / 2, -W / 4, 0, H * liquidScale, W / 2, W / 2 + topShift, 0.4);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}
