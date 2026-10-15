// Рендерит позы пловца в один PNG — ортогональные виды модели игрока с водой, чтобы проверять анимацию
// без браузера и WebGL (программный растеризатор боксов с z-буфером).
// Строки листа сверху вниз: кроль сбоку и сзади (6 фаз цикла рук), стойка на воде сбоку и спереди,
// нырок отвесно и под углом. Запуск: node tools/pose_sheet.ts [выход.png]
import { writeFileSync } from 'node:fs';
import { BoxGeometry, Matrix4, Mesh, Vector3, type Material, type Object3D } from 'three';
import { encodePNG } from './png.ts';
import { PlayerModel } from '../src/render/PlayerModel.ts';

type RGB = [number, number, number];
type View = 'side' | 'back' | 'front';

const SURFACE = 46.875; // видимая поверхность воды (верхний блок воды y=46)
const CELL = 240;
const SCALE = 100; // пикселей на блок
const COLUMNS = 6;
const SKY: RGB = [222, 236, 246];
const WATER: RGB = [48, 112, 205];
/** Куда смотрит камера; экранное «вправо» = dir × up (в виде «сбоку» пловец плывёт вправо). */
const VIEW_DIR: Record<View, Vector3> = {
  side: new Vector3(-1, 0, 0),
  back: new Vector3(0, 0, -1),
  front: new Vector3(0, 0, 1),
};
const FACE_SHADE = [0.78, 0.78, 1, 0.55, 0.9, 0.9]; // как в модели: +X, −X, +Y, −Y, +Z, −Z

const unitBox = new BoxGeometry(1, 1, 1);
const corners = unitBox.getAttribute('position');

function faceColor(material: Material): RGB {
  const m = material as Material & { map?: { image?: { data?: Uint8Array } }; color?: { getHex(): number } };
  const data = m.map?.image?.data;
  if (data) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 3]) { r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
    if (n) return [r / n, g / n, b / n];
  }
  const hex = m.color?.getHex() ?? 0x888888;
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

/** Рисует модель в квадрат CELL×CELL вокруг точки center; вода — полупрозрачная заливка ниже waterY. */
function renderCell(root: Object3D, view: View, center: Vector3): Uint8ClampedArray {
  const dir = VIEW_DIR[view];
  const right = new Vector3().crossVectors(dir, new Vector3(0, 1, 0)).normalize();
  const up = new Vector3().crossVectors(right, dir).normalize();
  const color = new Uint8ClampedArray(CELL * CELL * 3);
  const depth = new Float32Array(CELL * CELL).fill(Infinity);
  const project = (v: Vector3): [number, number, number] => {
    const rel = v.clone().sub(center);
    return [CELL / 2 + rel.dot(right) * SCALE, CELL / 2 - rel.dot(up) * SCALE, rel.dot(dir)];
  };
  const triangle = (a: number[], b: number[], c: number[], rgb: RGB): void => {
    const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
    if (Math.abs(den) < 1e-9) return;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(CELL - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(CELL - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den;
      const w2 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den;
      const w3 = 1 - w1 - w2;
      if (w1 < -1e-3 || w2 < -1e-3 || w3 < -1e-3) continue;
      const z = w1 * a[2] + w2 * b[2] + w3 * c[2];
      const i = y * CELL + x;
      if (z >= depth[i]) continue;
      depth[i] = z;
      color[i * 3] = rgb[0]; color[i * 3 + 1] = rgb[1]; color[i * 3 + 2] = rgb[2];
    }
  };
  root.updateWorldMatrix(true, true);
  const matrix = new Matrix4();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    for (let p: Object3D | null = obj; p; p = p.parent) if (!p.visible) return;
    matrix.copy(obj.matrixWorld);
    for (let face = 0; face < 6; face++) {
      const material = Array.isArray(obj.material) ? obj.material[face] : obj.material;
      const base = faceColor(material);
      const shade = FACE_SHADE[face];
      const rgb: RGB = [base[0] * shade, base[1] * shade, base[2] * shade];
      // BoxGeometry хранит вершины грани «зигзагом»: контур обходится как 0, 1, 3, 2.
      const quad = [0, 1, 3, 2].map((k) => project(
        new Vector3(corners.getX(face * 4 + k), corners.getY(face * 4 + k), corners.getZ(face * 4 + k)).applyMatrix4(matrix),
      ));
      const area = (quad[1][0] - quad[0][0]) * (quad[2][1] - quad[0][1]) - (quad[1][1] - quad[0][1]) * (quad[2][0] - quad[0][0]);
      if (area >= 0) continue; // обратная грань
      triangle(quad[0], quad[1], quad[2], rgb);
      triangle(quad[0], quad[2], quad[3], rgb);
    }
  });
  const waterRow = Math.round(CELL / 2 - (SURFACE - center.y) * SCALE);
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
    const i = y * CELL + x;
    const under = y >= waterRow;
    const base: RGB = depth[i] < Infinity ? [color[i * 3], color[i * 3 + 1], color[i * 3 + 2]] : SKY;
    const k = y === waterRow ? 1 : under ? 0.4 : 0;
    const mix = (c: number, w: number): number => c * (1 - k) + w * k;
    color[i * 3] = mix(base[0], y === waterRow ? 20 : WATER[0]);
    color[i * 3 + 1] = mix(base[1], y === waterRow ? 80 : WATER[1]);
    color[i * 3 + 2] = mix(base[2], y === waterRow ? 200 : WATER[2]);
  }
  return color;
}

interface Scenario { view: View; pose: Record<string, unknown>; centerY: number; frames: number; span: number }

const base = {
  x: 0, y: SURFACE - 1.3, z: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, vz: 0,
  onGround: false, flying: false, inWater: true, headInWater: false, waterSurfaceY: SURFACE,
};
const crawl = { ...base, vy: 0.25, vz: -3 };
const dive = { ...base, y: SURFACE - 2.4, headInWater: true };
const rows: Scenario[] = [
  { view: 'side', pose: crawl, centerY: SURFACE - 0.3, frames: COLUMNS, span: 1 },
  { view: 'back', pose: crawl, centerY: SURFACE - 0.3, frames: COLUMNS, span: 1 },
  { view: 'side', pose: base, centerY: SURFACE - 0.5, frames: COLUMNS, span: 0.9 },
  { view: 'front', pose: base, centerY: SURFACE - 0.5, frames: COLUMNS, span: 0.9 },
  { view: 'side', pose: { ...dive, vy: -2.6 }, centerY: SURFACE - 1.9, frames: COLUMNS, span: 0.6 },
  { view: 'side', pose: { ...dive, vy: -2.2, vz: -3 }, centerY: SURFACE - 2.0, frames: COLUMNS, span: 0.6 },
];

const W = COLUMNS * CELL;
const H = rows.length * CELL;
const sheet = new Uint8Array(W * H * 4);
rows.forEach((row, r) => {
  const model = new PlayerModel();
  for (let i = 0; i < 150; i++) model.update(1 / 60, row.pose as never); // дать позе установиться
  for (let c = 0; c < row.frames; c++) {
    for (let i = 0; i < Math.round((row.span / row.frames) * 60); i++) model.update(1 / 60, row.pose as never);
    const cell = renderCell(model.root, row.view, new Vector3(0, row.centerY, 0));
    for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) {
      const di = ((r * CELL + y) * W + c * CELL + x) * 4;
      sheet[di] = cell[(y * CELL + x) * 3]; sheet[di + 1] = cell[(y * CELL + x) * 3 + 1];
      sheet[di + 2] = cell[(y * CELL + x) * 3 + 2]; sheet[di + 3] = 255;
    }
  }
  model.dispose();
});
writeFileSync(process.argv[2] ?? '/tmp/swim_poses.png', encodePNG(W, H, sheet));
console.log(`позы пловца: ${rows.length} строк × ${COLUMNS} кадров →`, process.argv[2] ?? '/tmp/swim_poses.png');
