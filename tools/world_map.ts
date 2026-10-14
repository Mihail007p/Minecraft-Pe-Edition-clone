// Карта мира сверху (цвет верхнего блока + затенение по высоте) — для настройки генератора.
import { writeFileSync } from 'node:fs';
import { encodePNG } from './png.ts';
import { WorldGen } from '../src/world/WorldGen.ts';
import { Chunk } from '../src/world/Chunk.ts';
import { BLOCKS } from '../src/world/Blocks.ts';
import { getTexturePixels } from '../src/render/textures.ts';
import { faceTexture, FACE_PY } from '../src/world/Blocks.ts';

const seed = Number(process.argv[3] ?? 12345);
const chunksR = Number(process.argv[4] ?? 16); // радиус в чанках
const gen = new WorldGen(seed);
const size = chunksR * 2 * 16;
const img = new Uint8Array(size * size * 4);
const avgColor = new Map<number, [number, number, number]>();
function colorOf(id: number): [number, number, number] {
  let c = avgColor.get(id);
  if (c) return c;
  const px = getTexturePixels(faceTexture(BLOCKS[id], FACE_PY));
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) { if (px[i + 3] > 0) { r += px[i]; g += px[i + 1]; b += px[i + 2]; n++; } }
  c = [r / n, g / n, b / n];
  avgColor.set(id, c);
  return c;
}
let maxH = 0;
for (let cz = -chunksR; cz < chunksR; cz++) {
  for (let cx = -chunksR; cx < chunksR; cx++) {
    const chunk = new Chunk(cx, cz);
    gen.generateChunk(chunk);
    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const top = chunk.topNonAir(x, z);
      const id = chunk.get(x, top, z);
      maxH = Math.max(maxH, top);
      let [r, g, b] = colorOf(id);
      const shade = 0.6 + 0.4 * (top / 96);
      // вода — смешиваем с дном по глубине
      const px = (cx + chunksR) * 16 + x;
      const py = (cz + chunksR) * 16 + z;
      const i = (px + py * size) * 4;
      img[i] = r * shade; img[i + 1] = g * shade; img[i + 2] = b * shade; img[i + 3] = 255;
    }
  }
}
writeFileSync(process.argv[2] ?? '/tmp/map.png', encodePNG(size, size, img));
console.log('max height', maxH);
