import { CHUNK_HEIGHT, CHUNK_SIZE } from '../config.ts';

/** Индекс блока внутри чанка. Раскладка: x + z*16 + y*256 — столбцы идут подряд по y с шагом 256. */
export function blockIndex(x: number, y: number, z: number): number {
  return x + (z << 4) + (y << 8);
}

export function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

/** Данные одного чанка 16×H×16. Только данные — никакого рендера. */
export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly blocks: Uint8Array;
  /** Были ли блоки изменены игроком (нужно для сохранения и для того, чтобы не выгружать данные). */
  modified = false;
  /** Меш устарел и требует перестройки. */
  dirty = true;

  constructor(cx: number, cz: number, blocks?: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = blocks ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_HEIGHT);
  }

  get(x: number, y: number, z: number): number {
    if (y < 0 || y >= CHUNK_HEIGHT) return 0;
    return this.blocks[blockIndex(x, y, z)];
  }

  set(x: number, y: number, z: number, id: number): void {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    this.blocks[blockIndex(x, y, z)] = id;
  }

  /** Самый высокий непустой блок в столбце (или -1). */
  topNonAir(x: number, z: number): number {
    for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
      if (this.blocks[blockIndex(x, y, z)] !== 0) return y;
    }
    return -1;
  }
}
