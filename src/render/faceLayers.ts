import { BLOCKS, faceTexture } from '../world/Blocks.ts';
import { textureLayer } from './textures.ts';

/**
 * Таблица слоёв текстур для граней блоков: индекс = id*6 + грань.
 * Модуль не зависит от three.js, чтобы мешер можно было тестировать в Node.
 */
export const BLOCK_FACE_LAYER = new Uint16Array(256 * 6);

let filled = false;

export function fillFaceLayers(): void {
  if (filled) return;
  for (const def of BLOCKS) {
    for (let face = 0; face < 6; face++) {
      BLOCK_FACE_LAYER[def.id * 6 + face] = textureLayer(faceTexture(def, face));
    }
  }
  filled = true;
}
