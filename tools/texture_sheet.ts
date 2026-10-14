// Рендерит все процедурные текстуры в один PNG (для визуальной проверки).
import { writeFileSync } from 'node:fs';
import { encodePNG } from './png.ts';
import { TEXTURE_NAMES, getTexturePixels, TEX_SIZE } from '../src/render/textures.ts';

const scale = 4;
const cols = 8;
const rows = Math.ceil(TEXTURE_NAMES.length / cols);
const pad = 4;
const cell = TEX_SIZE * scale + pad;
const W = cols * cell + pad;
const H = rows * cell + pad;
const out = new Uint8Array(W * H * 4);
// фон — шахматка, чтобы видеть прозрачность
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (x + y * W) * 4;
  const v = ((x >> 3) + (y >> 3)) & 1 ? 200 : 160;
  out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
}
TEXTURE_NAMES.forEach((name, idx) => {
  const px = getTexturePixels(name);
  const ox = pad + (idx % cols) * cell;
  const oy = pad + Math.floor(idx / cols) * cell;
  for (let y = 0; y < TEX_SIZE * scale; y++) for (let x = 0; x < TEX_SIZE * scale; x++) {
    const sx = Math.floor(x / scale), sy = Math.floor(y / scale);
    const si = (sx + sy * TEX_SIZE) * 4;
    const a = px[si + 3] / 255;
    const di = (ox + x + (oy + y) * W) * 4;
    out[di] = px[si] * a + out[di] * (1 - a);
    out[di + 1] = px[si + 1] * a + out[di + 1] * (1 - a);
    out[di + 2] = px[si + 2] * a + out[di + 2] * (1 - a);
  }
});
writeFileSync(process.argv[2] ?? '/tmp/textures.png', encodePNG(W, H, out));
console.log(TEXTURE_NAMES.length, 'textures:', TEXTURE_NAMES.join(', '));
