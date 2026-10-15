// Процедурные пиксель-арт текстуры 16×16. Никаких внешних файлов:
// каждая текстура рисуется кодом детерминированно (сид — хеш имени),
// поэтому выглядит одинаково на всех устройствах и может строиться в воркере.

import { hashString, mulberry32 } from '../world/Noise.ts';

export const TEX_SIZE = 16;
const N = TEX_SIZE;

export type RGBA = readonly [number, number, number, number];
type Rng = () => number;

function c(r: number, g: number, b: number, a = 255): RGBA {
  return [r, g, b, a];
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

/** Осветлить/затемнить цвет: factor 1.0 — без изменений. */
export function shade(col: RGBA, factor: number): RGBA {
  return [clamp255(col[0] * factor), clamp255(col[1] * factor), clamp255(col[2] * factor), col[3]];
}

function add(col: RGBA, d: number): RGBA {
  return [clamp255(col[0] + d), clamp255(col[1] + d), clamp255(col[2] + d), col[3]];
}

class Tex {
  readonly data = new Uint8ClampedArray(N * N * 4);

  set(x: number, y: number, col: RGBA): void {
    if (x < 0 || y < 0 || x >= N || y >= N) return;
    const i = (x + y * N) * 4;
    this.data[i] = col[0];
    this.data[i + 1] = col[1];
    this.data[i + 2] = col[2];
    this.data[i + 3] = col[3];
  }

  get(x: number, y: number): RGBA {
    const i = (((x % N) + N) % N + (((y % N) + N) % N) * N) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  fill(col: RGBA): void {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) this.set(x, y, col);
  }

  rect(x0: number, y0: number, w: number, h: number, col: RGBA): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, col);
  }

  /** Применить функцию к каждому пикселю. */
  map(fn: (x: number, y: number, col: RGBA) => RGBA): void {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) this.set(x, y, fn(x, y, this.get(x, y)));
    }
  }
}

/** Бесшовный «пятнистый» шум: случайная сетка с билинейной интерполяцией и циклическим замыканием. */
function blotch(rng: Rng, cells: number): (x: number, y: number) => number {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rng() * 2 - 1;
  const scale = cells / N;
  return (x, y) => {
    const fx = x * scale;
    const fy = y * scale;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const g = (gx: number, gy: number) => grid[((gx % cells) + cells) % cells + (((gy % cells) + cells) % cells) * cells];
    const a = g(x0, y0), b = g(x0 + 1, y0), d = g(x0, y0 + 1), e = g(x0 + 1, y0 + 1);
    const top = a + (b - a) * tx;
    const bottom = d + (e - d) * tx;
    return top + (bottom - top) * ty;
  };
}

/** Заливка базовым цветом с пятнами и зерном. */
function grain(t: Tex, rng: Rng, base: RGBA, jitter: number, blotchAmp = 0, cells = 4): void {
  const b = blotch(rng, cells);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const d = (rng() * 2 - 1) * jitter + b(x, y) * blotchAmp;
      t.set(x, y, add(base, d));
    }
  }
}

/** Разбросать одиночные «крапинки». */
function speckle(t: Tex, rng: Rng, prob: number, delta: number): void {
  t.map((_x, _y, col) => (rng() < prob ? add(col, delta) : col));
}

// ---------- Палитра ----------
const COL = {
  stone: c(127, 127, 127),
  dirt: c(134, 96, 67),
  grass: c(109, 171, 66),
  sand: c(219, 207, 163),
  snow: c(241, 246, 246),
  bark: c(103, 81, 49),
  wood: c(170, 136, 85),
  plank: c(162, 131, 79),
  leaves: c(58, 116, 32),
  water: c(45, 96, 210, 168),
  cactus: c(85, 133, 50),
  cactusDark: c(60, 95, 36),
  mortar: c(96, 96, 96),
  brick: c(150, 97, 83),
  brickMortar: c(168, 164, 158),
};

// ---------- Генераторы ----------
type Generator = (t: Tex, rng: Rng) => void;

const generators: Record<string, Generator> = {
  missing(t) {
    t.map((x, y) => (((x >> 3) + (y >> 3)) & 1 ? c(248, 0, 248) : c(0, 0, 0)));
  },

  stone(t, rng) {
    grain(t, rng, COL.stone, 7, 16, 4);
    speckle(t, rng, 0.06, -22);
    speckle(t, rng, 0.04, 14);
  },

  dirt(t, rng) {
    grain(t, rng, COL.dirt, 9, 10, 4);
    speckle(t, rng, 0.12, -24);
    speckle(t, rng, 0.08, 16);
  },

  grass_top(t, rng) {
    grain(t, rng, COL.grass, 9, 14, 4);
    speckle(t, rng, 0.08, -18);
    speckle(t, rng, 0.05, 12);
  },

  grass_side(t, rng) {
    generators.dirt(t, rng);
    const g = new Tex();
    generators.grass_top(g, rng);
    for (let x = 0; x < N; x++) {
      const depth = 2 + (rng() < 0.55 ? 1 : 0) + (rng() < 0.2 ? 1 : 0);
      for (let y = 0; y < depth; y++) {
        const col = y === depth - 1 ? shade(g.get(x, y), 0.82) : g.get(x, y);
        t.set(x, y, col);
      }
    }
  },

  snow_grass_side(t, rng) {
    generators.dirt(t, rng);
    for (let x = 0; x < N; x++) {
      const depth = 2 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
      for (let y = 0; y < depth; y++) {
        t.set(x, y, add(COL.snow, (rng() * 2 - 1) * 6 - (y === depth - 1 ? 18 : 0)));
      }
    }
  },

  snow(t, rng) {
    grain(t, rng, COL.snow, 4, 6, 4);
    speckle(t, rng, 0.05, -10);
  },

  sand(t, rng) {
    grain(t, rng, COL.sand, 6, 10, 4);
    speckle(t, rng, 0.07, -14);
    speckle(t, rng, 0.05, 10);
  },

  gravel(t, rng) {
    grain(t, rng, c(128, 124, 120), 8, 6, 4);
    const palette = [c(150, 144, 138), c(110, 104, 100), c(136, 128, 118), c(92, 88, 86), c(160, 156, 150)];
    for (let i = 0; i < 14; i++) {
      const px = Math.floor(rng() * N);
      const py = Math.floor(rng() * N);
      const col = palette[Math.floor(rng() * palette.length)];
      const w = 2 + Math.floor(rng() * 2);
      const h = 2 + Math.floor(rng() * 2);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const edge = x === w - 1 || y === h - 1;
          t.set((px + x) % N, (py + y) % N, edge ? shade(col, 0.75) : col);
        }
      }
    }
  },

  cobblestone(t, rng) {
    const points: { x: number; y: number; v: number }[] = [];
    for (let i = 0; i < 9; i++) points.push({ x: rng() * N, y: rng() * N, v: (rng() * 2 - 1) * 20 });
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let d1 = Infinity, d2 = Infinity, v = 0;
        for (const p of points) {
          // Циклическое расстояние для бесшовности
          let dx = Math.abs(x + 0.5 - p.x); dx = Math.min(dx, N - dx);
          let dy = Math.abs(y + 0.5 - p.y); dy = Math.min(dy, N - dy);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; v = p.v; } else if (d < d2) d2 = d;
        }
        const edge = d2 - d1 < 1.1;
        const base = edge ? COL.mortar : add(COL.stone, v);
        t.set(x, y, add(base, (rng() * 2 - 1) * 7));
      }
    }
  },

  stone_bricks(t, rng) {
    grain(t, rng, c(122, 122, 122), 5, 8, 4);
    const mortar = c(88, 88, 88);
    for (let row = 0; row < 2; row++) {
      const y0 = row * 8;
      const offset = row === 0 ? 0 : 4;
      t.rect(0, y0 + 7, N, 1, mortar);
      for (let bx = 0; bx < 3; bx++) {
        const x0 = ((bx * 8 + offset) % N);
        t.rect(x0, y0, 1, 8, mortar);
        // лёгкая фаска
        for (let i = 1; i < 8; i++) t.set((x0 + i) % N, y0, add(t.get((x0 + i) % N, y0), 12));
      }
    }
    speckle(t, rng, 0.05, -14);
  },

  bricks(t, rng) {
    t.fill(COL.brickMortar);
    for (let row = 0; row < 4; row++) {
      const y0 = row * 4;
      const offset = row % 2 === 0 ? 0 : 4;
      for (let bx = -1; bx < 3; bx++) {
        const x0 = bx * 8 + offset;
        const v = (rng() * 2 - 1) * 14;
        for (let y = 0; y < 3; y++) {
          for (let x = 0; x < 7; x++) {
            const px = x0 + x;
            if (px < 0 || px >= N) continue;
            t.set(px, y0 + y, add(COL.brick, v + (rng() * 2 - 1) * 6));
          }
        }
      }
    }
  },

  planks(t, rng) {
    for (let y = 0; y < N; y++) {
      const plank = y >> 2;
      const seam = (y & 3) === 3;
      const grainShift = (rng() * 2 - 1) * 6;
      for (let x = 0; x < N; x++) {
        let col = add(COL.plank, grainShift + (rng() * 2 - 1) * 8);
        if (seam) col = shade(col, 0.68);
        // вертикальные стыки досок
        const joint = plank % 2 === 0 ? 11 : 4;
        if (!seam && x === joint) col = shade(col, 0.7);
        t.set(x, y, col);
      }
    }
  },

  log_side(t, rng) {
    for (let x = 0; x < N; x++) {
      const v = (rng() * 2 - 1) * 16;
      for (let y = 0; y < N; y++) {
        let col = add(COL.bark, v + (rng() * 2 - 1) * 7);
        if (rng() < 0.08) col = shade(col, 0.7);
        t.set(x, y, col);
      }
    }
  },

  log_top(t, rng) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        let col: RGBA;
        if (d > 6.5) col = COL.bark;
        else if (d > 5.5) col = shade(COL.wood, 0.8);
        else col = Math.floor(d) % 2 === 0 ? COL.wood : shade(COL.wood, 0.88);
        t.set(x, y, add(col, (rng() * 2 - 1) * 6));
      }
    }
  },

  leaves(t, rng) {
    t.fill(c(COL.leaves[0], COL.leaves[1], COL.leaves[2], 0));
    // Разреженная крона: крупные сквозные просветы и мягко просвечивающие листья.
    const kind = new Uint8Array(N * N);
    const put = (x: number, y: number, k: number) => {
      const px = ((x % N) + N) % N;
      const py = ((y % N) + N) % N;
      const i = px + py * N;
      if (k > kind[i]) kind[i] = k;
    };
    for (const [tx, ty] of [[4, 3], [5, 4], [11, 7], [12, 8], [3, 12], [4, 13], [13, 1], [14, 2]]) {
      put(tx, ty, 4);
    }
    const clusters = [
      [1, 0, 0], [11, 1, 0], [15, 2, 1],
      [3, 4, 1], [8, 3, 0], [13, 5, 0],
      [5, 7, 0], [15, 9, 0], [2, 10, 0],
      [7, 11, 1], [12, 12, 0], [1, 14, 1],
    ];
    for (const [lx, ly, dir] of clusters) {
      if (dir === 0) {
        put(lx, ly, 3); put(lx + 1, ly, 3);
        put(lx, ly + 1, 2); put(lx + 1, ly + 1, 2);
        put(lx + 2, ly + 1, 1); put(lx + 1, ly + 2, 1);
      } else {
        put(lx, ly, 3); put(lx - 1, ly + 1, 3);
        put(lx, ly + 1, 2); put(lx + 1, ly + 1, 1);
        put(lx - 1, ly + 2, 2); put(lx, ly + 2, 1);
      }
    }
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const k = kind[x + y * N];
        if (k === 0) continue;
        const d = (rng() * 2 - 1) * 6;
        if (k === 4) t.set(x, y, add(c(98, 74, 42, 242), d));
        else if (k === 1) t.set(x, y, add(c(44, 96, 24, 155), d));
        else if (k === 2) t.set(x, y, add(c(62, 128, 34, 180), d));
        else t.set(x, y, add(c(86, 158, 44, 205), d));
      }
    }
  },

  glass(t) {
    t.fill(c(0, 0, 0, 0));
    const frame = c(190, 220, 230);
    t.rect(0, 0, N, 1, frame);
    t.rect(0, N - 1, N, 1, frame);
    t.rect(0, 0, 1, N, frame);
    t.rect(N - 1, 0, 1, N, frame);
    const hi = c(230, 245, 250);
    for (let i = 0; i < 5; i++) { t.set(2 + i, 6 - i, hi); t.set(3 + i, 7 - i, hi); }
    t.set(1, 1, c(255, 255, 255));
  },

  water(t, rng) {
    const b = blotch(rng, 4);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const d = b(x, y) * 14 + (rng() * 2 - 1) * 6;
        const col = add(COL.water, d);
        t.set(x, y, [col[0], col[1], col[2], COL.water[3]]);
      }
    }
  },

  bedrock(t, rng) {
    grain(t, rng, c(85, 85, 85), 22, 18, 4);
    speckle(t, rng, 0.1, -30);
    speckle(t, rng, 0.08, 26);
  },

  coal_ore(t, rng) {
    generators.stone(t, rng);
    ore(t, rng, c(38, 38, 38), c(58, 58, 58));
  },

  iron_ore(t, rng) {
    generators.stone(t, rng);
    ore(t, rng, c(216, 175, 147), c(186, 140, 112));
  },

  sandstone_top(t, rng) {
    grain(t, rng, add(COL.sand, 6), 4, 6, 4);
    t.rect(0, 0, N, 1, add(COL.sand, 14));
    t.rect(0, 0, 1, N, add(COL.sand, 14));
    t.rect(N - 1, 0, 1, N, add(COL.sand, -12));
    t.rect(0, N - 1, N, 1, add(COL.sand, -12));
  },

  sandstone_side(t, rng) {
    grain(t, rng, COL.sand, 5, 6, 4);
    t.rect(0, 0, N, 2, add(COL.sand, 12));
    for (const row of [5, 9, 13]) {
      for (let x = 0; x < N; x++) {
        if (rng() < 0.8) t.set(x, row, add(COL.sand, -38));
      }
    }
    speckle(t, rng, 0.05, -12);
  },

  cactus_side(t, rng) {
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let col = add(COL.cactus, (rng() * 2 - 1) * 8);
        if (x === 0 || x === N - 1) col = COL.cactusDark;
        else if ((x + 1) % 4 === 0) col = shade(col, 0.8);
        else if ((x + 3) % 4 === 0 && (y % 4 === 1)) col = add(col, 50); // колючки
        t.set(x, y, col);
      }
    }
  },

  cactus_top(t, rng) {
    grain(t, rng, add(COL.cactus, 24), 6, 0);
    t.rect(0, 0, N, 1, COL.cactusDark);
    t.rect(0, N - 1, N, 1, COL.cactusDark);
    t.rect(0, 0, 1, N, COL.cactusDark);
    t.rect(N - 1, 0, 1, N, COL.cactusDark);
    for (let i = 3; i < 13; i += 3) {
      t.set(i, 1, add(COL.cactus, 60));
      t.set(1, i, add(COL.cactus, 60));
    }
  },

  tall_grass(t, rng) {
    t.fill(c(0, 0, 0, 0));
    const blades = 6 + Math.floor(rng() * 3);
    for (let i = 0; i < blades; i++) {
      const x0 = 1 + Math.floor(rng() * 14);
      const h = 6 + Math.floor(rng() * 8);
      const lean = rng() < 0.5 ? -1 : 1;
      const col = add(c(84, 146, 40), (rng() * 2 - 1) * 20);
      for (let k = 0; k < h; k++) {
        const y = N - 1 - k;
        const x = x0 + (k > h * 0.55 ? lean : 0);
        t.set(x, y, k > h - 3 ? add(col, 20) : col);
      }
    }
  },

  dandelion(t, rng) {
    t.fill(c(0, 0, 0, 0));
    flowerBase(t, rng);
    const petal = c(252, 216, 60);
    t.rect(6, 4, 3, 3, petal);
    t.set(7, 3, petal); t.set(7, 7, petal); t.set(5, 5, petal); t.set(9, 5, petal);
    t.set(7, 5, c(255, 240, 150));
  },

  poppy(t, rng) {
    t.fill(c(0, 0, 0, 0));
    flowerBase(t, rng);
    const petal = c(214, 36, 36);
    t.rect(6, 3, 3, 3, petal);
    t.set(5, 4, petal); t.set(9, 4, petal); t.set(7, 2, shade(petal, 0.85));
    t.set(7, 4, c(40, 40, 40));
    t.set(6, 6, shade(petal, 0.8)); t.set(8, 6, shade(petal, 0.8));
  },

  sapling(t, rng) {
    t.fill(c(0, 0, 0, 0));
    for (let y = 9; y < N; y++) t.set(7, y, add(COL.bark, (rng() * 2 - 1) * 10));
    for (let y = 3; y <= 10; y++) {
      for (let x = 4; x <= 10; x++) {
        const d = Math.abs(x - 7) + Math.abs(y - 6.5);
        if (d < 4 && rng() < 0.8) t.set(x, y, add(COL.leaves, (rng() * 2 - 1) * 24 + 10));
      }
    }
  },

  glowstone(t, rng) {
    grain(t, rng, c(205, 172, 108), 10, 12, 4);
    speckle(t, rng, 0.14, -60);
    speckle(t, rng, 0.1, 40);
  },

  obsidian(t, rng) {
    grain(t, rng, c(22, 18, 34), 6, 8, 4);
    speckle(t, rng, 0.08, 30);
    for (let i = 0; i < 4; i++) {
      const x = Math.floor(rng() * N), y = Math.floor(rng() * N);
      t.set(x, y, c(84, 60, 120)); t.set(x + 1, y, c(60, 44, 92)); t.set(x, y + 1, c(60, 44, 92));
    }
  },

  bookshelf(t, rng) {
    generators.planks(t, rng);
    const books = [c(168, 46, 36), c(46, 110, 60), c(50, 70, 150), c(132, 96, 50), c(210, 180, 70), c(228, 228, 220), c(110, 50, 140)];
    for (const y0 of [1, 9]) {
      let x = 1;
      while (x < N - 1) {
        const w = rng() < 0.4 ? 2 : 1;
        if (rng() < 0.12) { x += 1; continue; } // пустое место
        const col = books[Math.floor(rng() * books.length)];
        const h = 5 + (rng() < 0.5 ? 1 : 0);
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w && x + dx < N - 1; dx++) {
            t.set(x + dx, y0 + (6 - h) + dy, dx === w - 1 && w === 2 ? shade(col, 0.8) : col);
          }
        }
        x += w;
      }
      t.rect(0, y0, 1, 6, shade(COL.plank, 0.5));
      t.rect(N - 1, y0, 1, 6, shade(COL.plank, 0.5));
    }
  },

  crafting_table_top(t, rng) {
    generators.planks(t, rng);
    const line = shade(COL.plank, 0.55);
    t.rect(0, 0, N, 1, line); t.rect(0, N - 1, N, 1, line);
    t.rect(0, 0, 1, N, line); t.rect(N - 1, 0, 1, N, line);
    t.rect(5, 1, 1, N - 2, line); t.rect(10, 1, 1, N - 2, line);
    t.rect(1, 5, N - 2, 1, line); t.rect(1, 10, N - 2, 1, line);
  },

  crafting_table_side(t, rng) {
    generators.planks(t, rng);
    t.rect(0, 0, N, 3, shade(COL.plank, 0.75));
    t.rect(0, 3, N, 1, shade(COL.plank, 0.5));
    // пила
    const metal = c(190, 190, 190);
    t.rect(3, 6, 2, 7, metal);
    for (let y = 6; y < 13; y += 2) t.set(5, y, metal);
    t.rect(3, 13, 2, 2, COL.bark);
    // молоток
    t.rect(9, 6, 4, 2, c(120, 120, 120));
    t.rect(10, 8, 2, 6, COL.bark);
  },

  tnt_side(t, rng) {
    grain(t, rng, c(219, 68, 26), 6, 8, 4);
    t.rect(0, 4, N, 1, c(140, 36, 10));
    t.rect(0, 11, N, 1, c(140, 36, 10));
    t.rect(0, 5, N, 6, c(236, 236, 236));
    const ink = c(30, 30, 30);
    // T N T пиксельным шрифтом 3×5, с y=6
    const T = [[1, 1, 1], [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0]];
    const Nn = [[1, 0, 1], [1, 1, 1], [1, 1, 1], [1, 0, 1], [1, 0, 1]];
    const glyphs = [T, Nn, T];
    glyphs.forEach((g, gi) => {
      const x0 = 2 + gi * 4;
      g.forEach((row, ry) => row.forEach((v, rx) => { if (v) t.set(x0 + rx, 6 + ry, ink); }));
    });
  },

  tnt_top(t, rng) {
    grain(t, rng, c(219, 68, 26), 6, 8, 4);
    t.rect(1, 1, N - 2, N - 2, c(200, 60, 24));
    t.rect(4, 4, 8, 8, c(170, 48, 18));
    t.rect(6, 6, 4, 4, c(110, 110, 110));
    t.rect(7, 7, 2, 2, c(60, 60, 60));
  },

  tnt_bottom(t, rng) {
    grain(t, rng, c(200, 62, 24), 6, 8, 4);
    t.rect(4, 4, 8, 8, c(150, 44, 16));
  },
};

function ore(t: Tex, rng: Rng, dark: RGBA, light: RGBA): void {
  const shapes = [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 1]],
    [[0, 0], [1, 1], [1, 0]],
  ];
  const count = 5 + Math.floor(rng() * 2);
  for (let i = 0; i < count; i++) {
    const shapeIdx = Math.floor(rng() * shapes.length);
    const shape = shapes[shapeIdx];
    const px = Math.floor(rng() * N);
    const py = Math.floor(rng() * N);
    shape.forEach(([dx, dy], k) => {
      t.set((px + dx) % N, (py + dy) % N, k % 2 === 0 ? dark : light);
    });
  }
}

function flowerBase(t: Tex, rng: Rng): void {
  const stem = c(64, 120, 36);
  for (let y = 7; y < N; y++) t.set(7, y, add(stem, (rng() * 2 - 1) * 10));
  t.set(6, 11, stem); t.set(5, 12, stem);
  t.set(8, 12, stem); t.set(9, 13, stem);
}

const WOOL_COLORS: Record<string, RGBA> = {
  wool_white: c(234, 236, 237),
  wool_red: c(176, 46, 38),
  wool_orange: c(240, 118, 19),
  wool_yellow: c(248, 197, 39),
  wool_lime: c(112, 185, 25),
  wool_green: c(84, 109, 27),
  wool_cyan: c(21, 137, 145),
  wool_blue: c(53, 57, 157),
  wool_purple: c(121, 42, 172),
  wool_pink: c(237, 141, 172),
  wool_gray: c(62, 68, 71),
  wool_black: c(24, 25, 29),
};

for (const [name, col] of Object.entries(WOOL_COLORS)) {
  generators[name] = (t, rng) => {
    const b = blotch(rng, 8);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 4 : -4;
        t.set(x, y, add(col, b(x, y) * 10 + weave + (rng() * 2 - 1) * 5));
      }
    }
  };
}

generators.chest = (t, rng) => {
  generators.planks(t, rng);
  t.rect(0, 0, 16, 1, c(74, 48, 25));
  t.rect(0, 5, 16, 2, c(63, 42, 21));
  t.rect(0, 15, 16, 1, c(74, 48, 25));
  t.rect(0, 0, 1, 16, c(74, 48, 25));
  t.rect(15, 0, 1, 16, c(74, 48, 25));
  t.rect(7, 5, 2, 4, c(205, 202, 174));
};
generators.furnace_side = (t, rng) => {
  generators.stone(t, rng);
  t.rect(3, 3, 10, 3, c(44, 44, 44));
  t.rect(3, 9, 10, 5, c(38, 38, 38));
  t.rect(4, 10, 8, 1, c(76, 76, 76));
};

// Самостоятельно нарисованные текстуры блоков из рецептов.
for (const [name, col] of Object.entries({
  clay: c(157, 164, 179), coal_block: c(35, 35, 35), iron_block: c(207, 210, 213),
  gold_block: c(239, 197, 47), diamond_block: c(65, 210, 197), emerald_block: c(38, 184, 86),
  redstone_block: c(172, 28, 20), lapis_block: c(33, 69, 155), quartz_block: c(224, 218, 202),
})) {
  generators[name] = (t, rng) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const edge = name === 'clay' ? 0 : x === 0 || y === 0 ? 18 : x === 15 || y === 15 ? -30 : 0;
      t.set(x, y, add(col, edge + (rng() - 0.5) * 12));
    }
  };
}

/** Имена всех текстур — порядок задаёт индексы слоёв в массиве текстур. */
export const TEXTURE_NAMES: readonly string[] = Object.keys(generators);

const cache = new Map<string, Uint8ClampedArray>();

/** Сгенерировать (или взять из кэша) пиксели текстуры RGBA 16×16. */
export function getTexturePixels(name: string): Uint8ClampedArray {
  let px = cache.get(name);
  if (px) return px;
  const gen = generators[name] ?? generators.missing;
  const t = new Tex();
  gen(t, mulberry32(hashString(name) ^ 0x5bd1e995));
  px = t.data;
  cache.set(name, px);
  return px;
}

export function textureLayer(name: string): number {
  const i = TEXTURE_NAMES.indexOf(name);
  return i >= 0 ? i : 0;
}

/** Текстура облаков (тайлится, 64×64, белый с альфой). */
export function generateCloudTexture(size = 64, seed = 1234): Uint8ClampedArray {
  const rng = mulberry32(seed);
  const data = new Uint8ClampedArray(size * size * 4);
  const grid = 8;
  const cells = size / grid;
  const g = new Float32Array(cells * cells);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const sample = (x: number, y: number) => g[((x % cells) + cells) % cells + (((y % cells) + cells) % cells) * cells];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x / grid, fy = y / grid;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const a = sample(x0, y0), b = sample(x0 + 1, y0), d = sample(x0, y0 + 1), e = sample(x0 + 1, y0 + 1);
      const v = (a + (b - a) * tx) * (1 - ty) + (d + (e - d) * tx) * ty;
      // Пикселизуем облака крупными "клетками", как в оригинале
      const on = v > 0.56;
      const i = (x + y * size) * 4;
      data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; data[i + 3] = on ? 220 : 0;
    }
  }
  return data;
}
