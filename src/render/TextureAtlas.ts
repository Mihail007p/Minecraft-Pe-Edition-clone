import {
  DataArrayTexture, NearestFilter, RGBAFormat, UnsignedByteType,
} from 'three';
import { fillFaceLayers } from './faceLayers.ts';
import { TEXTURE_NAMES, TEX_SIZE, getTexturePixels } from './textures.ts';

/** Собирает все процедурные текстуры в DataArrayTexture (по слою на текстуру). */
export function createBlockTextureArray(_maxAnisotropy = 1): DataArrayTexture {
  fillFaceLayers();
  const layers = TEXTURE_NAMES.length;
  const bytesPerLayer = TEX_SIZE * TEX_SIZE * 4;
  const data = new Uint8Array(bytesPerLayer * layers);
  TEXTURE_NAMES.forEach((name, i) => {
    data.set(getTexturePixels(name), i * bytesPerLayer);
  });
  const texture = new DataArrayTexture(data, TEX_SIZE, TEX_SIZE, layers);
  texture.format = RGBAFormat;
  texture.type = UnsignedByteType;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}
