// Детальная пиксельная модель игрока для вида от третьего лица.
//
// Модель собрана только из процедурных текстур (DataTexture) и боксов —
// без внешних файлов и ассетов Mojang. Пропорции повторяют физику игрока:
// рост 1.8 блока, глаза на 1.62. Вперёд у модели — локальный −Z, поэтому
// root.rotation.y = yaw игрока сразу ставит её по взгляду.
//
// Анимации: ходьба/бег с махами рук и ног от пройденной фазы, дыхание на месте,
// прыжок и падение, плавание «кролем», парение в полёте, взмах правой рукой
// при добыче/установке блока и моргание.

import {
  BoxGeometry, DataTexture, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  NearestFilter, RGBAFormat, SRGBColorSpace, type Material, type Texture,
} from 'three';
import {
  PLAYER_EYE_HEIGHT, THIRD_PERSON_DISTANCE, THIRD_PERSON_HEIGHT, type CameraView,
} from '../config.ts';
import { AIR, BLOCKS, faceTexture as blockFaceTexture } from '../world/Blocks.ts';
import { TEX_SIZE, getTexturePixels } from './textures.ts';

/** Всё, что модели нужно знать об игроке на кадр (структурно совместимо с Player). */
export interface PlayerPoseSource {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
}

export interface CameraPose {
  position: [number, number, number];
  yaw: number;
  pitch: number;
}

type SolidFn = (x: number, y: number, z: number) => boolean;

/**
 * Поза камеры для выбранного вида. Для третьего лица камера отодвигается
 * от глаз игрока и укорачивает дистанцию перед первым твёрдым блоком,
 * чтобы не проваливаться сквозь стены.
 */
export function cameraPoseForView(
  view: CameraView,
  p: { x: number; y: number; z: number; yaw: number; pitch: number },
  isSolid?: SolidFn,
): CameraPose {
  const eye: [number, number, number] = [p.x, p.y + PLAYER_EYE_HEIGHT, p.z];
  if (view === 'first') return { position: eye, yaw: p.yaw, pitch: p.pitch };

  const cp = Math.cos(p.pitch);
  const dir: [number, number, number] = [-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp];
  const sign = view === 'third-back' ? -1 : 1;
  const offset: [number, number, number] = [
    dir[0] * sign * THIRD_PERSON_DISTANCE,
    dir[1] * sign * THIRD_PERSON_DISTANCE + (view === 'third-back' ? THIRD_PERSON_HEIGHT : 0),
    dir[2] * sign * THIRD_PERSON_DISTANCE,
  ];

  let position = offset.map((v, i) => eye[i] + v) as [number, number, number];
  if (isSolid) {
    // Идём от глаз наружу мелкими шагами и останавливаемся перед стеной.
    let safe = 0;
    const steps = 42;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const cx = eye[0] + offset[0] * t;
      const cy = eye[1] + offset[1] * t;
      const cz = eye[2] + offset[2] * t;
      if (isSolid(Math.floor(cx), Math.floor(cy), Math.floor(cz))) break;
      safe = t;
    }
    // Совсем вплотную к стене честнее почти первое лицо, чем камера в блоке.
    const t = Math.max(safe, 0.04);
    position = [eye[0] + offset[0] * t, eye[1] + offset[1] * t, eye[2] + offset[2] * t];
  }

  return view === 'third-back'
    ? { position, yaw: p.yaw, pitch: p.pitch }
    : { position, yaw: p.yaw + Math.PI, pitch: -p.pitch };
}

// ------------------------------------------------------------------ пиксели

type RGB = readonly [number, number, number];

const rgb = (hex: number): RGB => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const shade = (col: RGB, f: number): RGB => [
  Math.max(0, Math.min(255, Math.round(col[0] * f))),
  Math.max(0, Math.min(255, Math.round(col[1] * f))),
  Math.max(0, Math.min(255, Math.round(col[2] * f))),
];
/** Детерминированное зерно без генератора случайных чисел. */
const grainAt = (x: number, y: number): number => {
  let h = (x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000 - 0.5;
};

/** Пиксельная картинка; y=0 — верх (при записи переворачиваем под UV бокса). */
class Pix {
  readonly data: Uint8ClampedArray;
  readonly size: number;
  constructor(size: number) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
  }
  set(x: number, y: number, col: RGB, a = 255): void {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return;
    const row = this.size - 1 - y;
    const i = (x + row * this.size) * 4;
    this.data[i] = col[0]; this.data[i + 1] = col[1]; this.data[i + 2] = col[2]; this.data[i + 3] = a;
  }
  rect(x0: number, y0: number, w: number, h: number, col: RGB): void {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, col);
  }
  fill(col: RGB, jitter = 0): void {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) {
      this.set(x, y, shade(col, 1 + grainAt(x, y) * jitter));
    }
  }
}

// Палитра персонажа (собственный образ, не скин Minecraft).
const SKIN = rgb(0xc98a5e);
const SKIN_LIGHT = rgb(0xdda273);
const SKIN_DARK = rgb(0xa96f42);
const HAIR = rgb(0x3a2317);
const HAIR_LIGHT = rgb(0x5b3a24);
const SHIRT = rgb(0x15917e);
const SHIRT_DARK = rgb(0x0d6b5e);
const SHIRT_LIGHT = rgb(0x2cb3a0);
const PANTS = rgb(0x35479b);
const PANTS_DARK = rgb(0x27336e);
const ACCENT = rgb(0xf2a63b);

function faceTexture(eyesOpen: boolean): Pix {
  const t = new Pix(32);
  t.fill(SKIN, 0.07);
  // Подбородок и скулы чуть темнее, лоб светлее.
  t.rect(0, 0, 32, 7, SKIN_LIGHT);
  t.rect(0, 26, 32, 6, shade(SKIN, 0.92));
  t.rect(0, 12, 4, 12, shade(SKIN, 0.96));
  t.rect(28, 12, 4, 12, shade(SKIN, 0.96));
  // Румянец.
  t.rect(4, 20, 5, 3, shade(SKIN, 1.04));
  t.rect(23, 20, 5, 3, shade(SKIN, 1.04));
  // Брови.
  t.rect(7, 11, 7, 2, HAIR);
  t.rect(18, 11, 7, 2, HAIR);
  if (eyesOpen) {
    for (const ex of [8, 19]) {
      t.rect(ex, 14, 5, 5, rgb(0xf7f3e8)); // белок
      t.rect(ex + 1, 15, 3, 4, rgb(0x5b3a1e)); // радужка
      t.rect(ex + 2, 16, 2, 2, rgb(0x17100b)); // зрачок
      t.set(ex + 1, 15, rgb(0xffffff)); // блик
      t.rect(ex, 19, 5, 1, SKIN_DARK); // нижнее веко
    }
  } else {
    t.rect(8, 16, 5, 1, SKIN_DARK);
    t.rect(19, 16, 5, 1, SKIN_DARK);
  }
  // Нос и рот.
  t.rect(15, 18, 2, 5, SKIN_DARK);
  t.rect(14, 22, 4, 1, SKIN_DARK);
  t.rect(12, 26, 8, 1, rgb(0x8a5638));
  t.rect(13, 27, 6, 1, shade(SKIN, 0.9));
  return t;
}

function headSideTexture(): Pix {
  const t = new Pix(32);
  t.fill(SKIN, 0.07);
  t.rect(0, 0, 32, 10, HAIR); // волосы сверху и у виска
  t.rect(0, 10, 32, 2, HAIR_LIGHT);
  t.rect(24, 10, 8, 8, HAIR); // чёлка сбоку спадает у лба
  t.rect(0, 28, 32, 4, shade(SKIN, 0.92));
  return t;
}

function headBackTexture(): Pix {
  const t = new Pix(32);
  t.fill(HAIR, 0.1);
  t.rect(0, 22, 32, 4, HAIR_LIGHT);
  t.rect(0, 27, 32, 5, SKIN_DARK); // шея под волосами
  for (let x = 3; x < 30; x += 6) t.rect(x, 4, 2, 16, shade(HAIR, 1.18)); // пряди
  return t;
}

function hairTopTexture(): Pix {
  const t = new Pix(32);
  t.fill(HAIR, 0.1);
  for (let i = 0; i < 8; i++) t.rect(2 + i * 4, 3 + (i % 3) * 8, 2, 9, HAIR_LIGHT); // пряди
  t.rect(0, 0, 32, 3, HAIR_LIGHT);
  return t;
}

function torsoTexture(back: boolean): Pix {
  const t = new Pix(16);
  t.fill(SHIRT, 0.08);
  t.rect(0, 0, 16, 2, SHIRT_DARK); // ворот
  t.rect(7, 0, 2, 3, SHIRT_LIGHT);
  t.rect(0, 13, 16, 3, SHIRT_DARK); // низ куртки
  t.rect(0, 12, 16, 1, SHIRT_LIGHT);
  if (!back) {
    t.rect(2, 3, 3, 9, shade(SHIRT, 1.1)); // планка/блик слева
    t.rect(11, 4, 4, 4, SHIRT_DARK); // нагрудный карман
    t.rect(11, 4, 4, 1, ACCENT); // кант кармана
    t.rect(7, 6, 2, 2, ACCENT); // значок-ромб по центру
    t.set(6, 7, ACCENT); t.set(9, 7, ACCENT); t.set(7, 8, ACCENT); t.set(8, 8, ACCENT);
    t.rect(3, 10, 2, 2, SHIRT_LIGHT); // блик ткани
  } else {
    t.rect(3, 2, 2, 11, SHIRT_DARK); // ремни рюкзака по краям спины
    t.rect(11, 2, 2, 11, SHIRT_DARK);
    t.rect(7, 5, 2, 5, shade(SHIRT, 1.12));
  }
  return t;
}

function sleeveTexture(): Pix {
  const t = new Pix(16);
  t.fill(SHIRT, 0.08);
  t.rect(0, 0, 16, 3, SHIRT_LIGHT);
  t.rect(0, 12, 16, 4, SHIRT_DARK); // манжета
  t.rect(0, 11, 16, 1, ACCENT);
  return t;
}

function pantsTexture(): Pix {
  const t = new Pix(16);
  t.fill(PANTS, 0.08);
  t.rect(0, 0, 16, 3, PANTS_DARK); // пояс/верх джинсов
  t.rect(2, 4, 4, 4, PANTS_DARK); // карман
  t.rect(2, 4, 4, 1, shade(PANTS, 1.25));
  t.rect(7, 8, 6, 5, shade(PANTS, 1.14)); // заплатка на колене
  for (let y = 4; y < 16; y += 3) t.set(1, y, shade(PANTS, 1.2)); // шов
  t.rect(0, 14, 16, 2, PANTS_DARK);
  return t;
}

function skinTexture(dark = false): Pix {
  const t = new Pix(16);
  t.fill(dark ? SKIN_DARK : SKIN, 0.07);
  return t;
}

function handTexture(): Pix {
  const t = new Pix(16);
  t.fill(SKIN, 0.07);
  for (const x of [4, 8, 12]) t.rect(x, 8, 1, 8, SKIN_DARK); // пальцы
  t.rect(0, 6, 16, 1, SKIN_DARK); // костяшки
  return t;
}

// ------------------------------------------------------------------ модель

interface PartRefs {
  head: Group;
  armL: Group;
  armR: Group;
  legL: Group;
  legR: Group;
}

/** Детальная модель игрока: голова с лицом и причёской, одежда, рюкзак, анимации. */
export class PlayerModel {
  readonly root = new Group();
  private body = new Group();
  private parts: PartRefs;
  private headMesh: Mesh;
  private heldMesh!: Mesh;
  private heldBlockId = -1;
  private headMatsOpen: Material[];
  private headMatsClosed: Material[];
  private geometry: BoxGeometry;
  private materials = new Set<Material>();
  private textures = new Set<Texture>();

  private time = 0;
  private walkPhase = 0;
  private smoothSpeed = 0;
  private actionTime = Number.POSITIVE_INFINITY;
  private blinkLeft = 0;
  private nextBlink = 1.8;

  constructor() {
    this.geometry = new BoxGeometry(1, 1, 1);
    const normals = this.geometry.getAttribute('normal');
    const colors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const shadeF = normals.getY(i) > 0 ? 1 : normals.getY(i) < 0 ? 0.55 : normals.getX(i) !== 0 ? 0.78 : 0.9;
      colors.push(shadeF, shadeF, shadeF);
    }
    this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.root.add(this.body);
    this.root.name = 'player-model';

    // --- Материалы ---
    const faceOpen = this.texMat(faceTexture(true));
    const faceClosed = this.texMat(faceTexture(false));
    const headSide = this.texMat(headSideTexture());
    const headBack = this.texMat(headBackTexture());
    const hairTop = this.texMat(hairTopTexture());
    const skinMat = this.texMat(skinTexture());
    // Порядок граней BoxGeometry: +X, −X, +Y, −Y, +Z(спина), −Z(лицо).
    this.headMatsOpen = [headSide, headSide, hairTop, skinMat, headBack, faceOpen];
    this.headMatsClosed = [headSide, headSide, hairTop, skinMat, headBack, faceClosed];
    const torsoFront = this.texMat(torsoTexture(false));
    const torsoBack = this.texMat(torsoTexture(true));
    const shirtSide = this.texMat(sleeveTexture());
    const torsoMats = [shirtSide, shirtSide, this.solid(SHIRT_DARK), this.solid(SHIRT_DARK), torsoBack, torsoFront];
    const sleeveMat = this.texMat(sleeveTexture());
    const pantsMat = this.texMat(pantsTexture());
    const handMat = this.texMat(handTexture());
    const hairMat = this.solid(HAIR);
    const hairLightMat = this.solid(HAIR_LIGHT);

    // --- Ноги (точка поворота — бедро, y=0.68) ---
    const makeLeg = (side: -1 | 1): Group => {
      const leg = new Group();
      leg.name = side < 0 ? 'leg-left' : 'leg-right';
      leg.position.set(side * 0.13, 0.68, 0);
      this.box(leg, pantsMat, [0.24, 0.56, 0.26], [0, -0.3, 0], 'thigh');
      this.box(leg, this.solid(PANTS_DARK), [0.26, 0.08, 0.28], [0, -0.56, 0], 'cuff');
      // Ботинок: подошва, носок, задник и шнурки отдельными деталями.
      const shoe = new Group();
      shoe.name = 'shoe';
      shoe.position.set(0, -0.62, 0);
      this.box(shoe, this.solid(0x2e2a26), [0.27, 0.07, 0.44], [0, -0.035, -0.05], 'sole');
      this.box(shoe, this.solid(0x4a423a), [0.26, 0.1, 0.4], [0, 0.03, -0.04], 'shoe-body');
      this.box(shoe, this.solid(0x6b5d4f), [0.26, 0.08, 0.14], [0, 0.035, -0.2], 'toe');
      this.box(shoe, this.solid(0xe8e2d4), [0.18, 0.025, 0.05], [0, 0.09, -0.13], 'lace-1');
      this.box(shoe, this.solid(0xe8e2d4), [0.18, 0.025, 0.05], [0, 0.09, -0.05], 'lace-2');
      leg.add(shoe);
      this.body.add(leg);
      return leg;
    };
    const legL = makeLeg(-1);
    const legR = makeLeg(1);

    // --- Торс (от бёдер 0.68 до плеч 1.36) ---
    const torso = new Group();
    torso.name = 'torso';
    torso.position.set(0, 0.68, 0);
    this.body.add(torso);
    this.box(torso, torsoMats, [0.52, 0.68, 0.28], [0, 0.34, 0], 'chest');
    this.box(torso, this.solid(0x6e4a26), [0.54, 0.09, 0.3], [0, 0.05, 0], 'belt');
    this.box(torso, this.solid(0xf2c14e), [0.14, 0.07, 0.02], [0, 0.05, -0.16], 'buckle');
    // Ромб-значок и ремни рюкзака спереди.
    const emblem = this.box(torso, this.solid(ACCENT), [0.13, 0.13, 0.02], [0, 0.42, -0.15], 'emblem');
    emblem.rotation.z = Math.PI / 4;
    this.box(torso, this.solid(SHIRT_DARK), [0.07, 0.5, 0.02], [-0.17, 0.36, -0.15], 'strap-left');
    this.box(torso, this.solid(SHIRT_DARK), [0.07, 0.5, 0.02], [0.17, 0.36, -0.15], 'strap-right');
    // Рюкзак на спине: корпус, клапан, карман, рулон сверху и ремешки снизу.
    const pack = new Group();
    pack.name = 'backpack';
    pack.position.set(0, 0.36, 0.24);
    this.box(pack, this.solid(0x8a6742), [0.4, 0.5, 0.18], [0, 0, 0], 'pack-body');
    this.box(pack, this.solid(0x6e4f30), [0.42, 0.16, 0.2], [0, 0.2, 0], 'pack-flap');
    this.box(pack, this.solid(0xa67c4e), [0.28, 0.2, 0.04], [0, -0.1, 0.1], 'pack-pocket');
    this.box(pack, this.solid(0xf2c14e), [0.1, 0.06, 0.02], [0, 0.2, -0.1], 'pack-clasp');
    this.box(pack, this.solid(SHIRT), [0.44, 0.13, 0.13], [0, 0.35, 0], 'bedroll');
    this.box(pack, this.solid(0x54381e), [0.44, 0.05, 0.05], [0, -0.27, 0], 'pack-strap');
    torso.add(pack);
    // Шея и воротник.
    this.box(torso, skinMat, [0.18, 0.12, 0.18], [0, 0.72, 0], 'neck');
    this.box(torso, this.solid(SHIRT_DARK), [0.34, 0.07, 0.3], [0, 0.69, 0], 'collar');

    // --- Руки (точка поворота — плечо) ---
    const makeArm = (side: -1 | 1): Group => {
      const arm = new Group();
      arm.name = side < 0 ? 'arm-left' : 'arm-right';
      arm.position.set(side * 0.36, 0.62, 0);
      this.box(arm, sleeveMat, [0.21, 0.3, 0.23], [0, -0.15, 0], 'sleeve');
      this.box(arm, skinMat, [0.19, 0.22, 0.2], [0, -0.4, 0], 'forearm');
      this.box(arm, handMat, [0.2, 0.16, 0.21], [0, -0.58, 0], 'hand');
      this.box(arm, skinMat, [0.06, 0.12, 0.08], [-side * 0.12, -0.56, -0.04], 'thumb');
      if (side < 0) this.box(arm, this.solid(ACCENT), [0.23, 0.07, 0.25], [0, -0.31, 0], 'wristband');
      if (side > 0) {
        // Выбранный блок в правой руке (материалы ставит setHeldBlock).
        this.heldMesh = this.box(arm, this.solid(0x000000), [0.3, 0.3, 0.3], [0, -0.78, -0.1], 'held-item');
        this.heldMesh.rotation.set(0.15, 0.5, 0);
        this.heldMesh.visible = false;
      }
      torso.add(arm);
      return arm;
    };
    const armL = makeArm(-1);
    const armR = makeArm(1);

    // --- Голова (точка поворота — шея, суммарно центр ≈1.58) ---
    const head = new Group();
    head.name = 'head';
    head.position.set(0, 0.74, 0);
    torso.add(head);
    this.headMesh = this.box(head, this.headMatsOpen, [0.5, 0.47, 0.48], [0, 0.235, 0], 'skull');
    // Причёска: шапка волос, задняя и боковые панели, чёлка с «зубцами».
    this.box(head, hairMat, [0.54, 0.1, 0.52], [0, 0.5, 0], 'hair-top');
    this.box(head, hairMat, [0.54, 0.36, 0.09], [0, 0.3, 0.235], 'hair-back');
    this.box(head, hairMat, [0.09, 0.32, 0.52], [-0.255, 0.31, 0], 'hair-left');
    this.box(head, hairMat, [0.09, 0.32, 0.52], [0.255, 0.31, 0], 'hair-right');
    this.box(head, hairMat, [0.54, 0.13, 0.09], [0, 0.43, -0.235], 'fringe');
    const teeth = [-0.18, -0.06, 0.06, 0.18];
    teeth.forEach((x, i) => {
      this.box(head, i % 2 ? hairLightMat : hairMat, [0.09, 0.08 + (i % 2) * 0.05, 0.09], [x, 0.35, -0.235], `fringe-tooth-${i}`);
    });
    // Уши.
    this.box(head, skinMat, [0.07, 0.15, 0.17], [-0.28, 0.2, 0], 'ear-left');
    this.box(head, skinMat, [0.07, 0.15, 0.17], [0.28, 0.2, 0], 'ear-right');

    this.parts = { head, armL, armR, legL, legR };
  }

  private register(material: Material): Material {
    this.materials.add(material);
    return material;
  }

  private solid(hex: number | RGB): MeshBasicMaterial {
    const color = typeof hex === 'number' ? hex : (hex[0] << 16) | (hex[1] << 8) | hex[2];
    return this.register(new MeshBasicMaterial({ color, vertexColors: true })) as MeshBasicMaterial;
  }

  private texMat(pix: Pix): MeshBasicMaterial {
    return this.texMatFromPixels(new Uint8Array(pix.data.buffer), pix.size);
  }

  private texMatFromPixels(data: Uint8Array, size: number, transparent = false): MeshBasicMaterial {
    const texture = new DataTexture(data, size, size, RGBAFormat);
    texture.magFilter = NearestFilter;
    texture.minFilter = NearestFilter;
    texture.colorSpace = SRGBColorSpace;
    texture.needsUpdate = true;
    this.textures.add(texture);
    return this.register(new MeshBasicMaterial({
      map: texture, vertexColors: true, transparent, alphaTest: transparent ? 0.5 : 0,
    })) as MeshBasicMaterial;
  }

  /**
   * Предмет в правой руке: мини-куб с настоящими текстурами выбранного блока.
   * AIR, неизвестные и «крестовые» блоки (трава, цветы) руку оставляют пустой.
   */
  setHeldBlock(blockId: number): void {
    if (blockId === this.heldBlockId) return;
    this.heldBlockId = blockId;
    const def = BLOCKS[blockId];
    if (!def || blockId === AIR || def.shape === 'cross') {
      this.heldMesh.visible = false;
      return;
    }
    // Порядок материалов BoxGeometry совпадает с FACE_* в Blocks.ts.
    const mats: Material[] = [];
    for (let face = 0; face < 6; face++) {
      const pixels = getTexturePixels(blockFaceTexture(def, face));
      mats.push(this.texMatFromPixels(new Uint8Array(pixels), TEX_SIZE, def.shape !== 'cube'));
    }
    this.heldMesh.material = mats;
    this.heldMesh.visible = true;
  }

  private box(
    parent: Group, material: Material | Material[], size: [number, number, number],
    pos: [number, number, number], name: string,
  ): Mesh {
    const mesh = new Mesh(this.geometry, material);
    mesh.name = name;
    mesh.scale.set(size[0], size[1], size[2]);
    mesh.position.set(pos[0], pos[1], pos[2]);
    parent.add(mesh);
    return mesh;
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Запустить взмах правой рукой (добыча, удар, установка блока). */
  swingArm(): void {
    this.actionTime = 0;
  }

  update(dt: number, p: PlayerPoseSource): void {
    this.time += dt;
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.y = p.yaw;

    const speed = Math.hypot(p.vx, p.vz);
    this.smoothSpeed += (speed - this.smoothSpeed) * (1 - Math.exp(-10 * dt));
    const { head, armL, armR, legL, legR } = this.parts;

    // Моргание: закрываем глаза на 0.13 c каждые ~2–5 c.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) { this.blinkLeft = 0.13; this.nextBlink = 2 + ((this.time * 7919) % 3); }
    if (this.blinkLeft > 0) this.blinkLeft -= dt;
    this.headMesh.material = this.blinkLeft > 0 ? this.headMatsClosed : this.headMatsOpen;

    // Голова следует за наклоном взгляда.
    head.rotation.x = p.pitch * 0.85;
    head.rotation.z = Math.sin(this.time * 0.7) * 0.01;

    let legSwing = 0;
    let armSwing = 0;
    let lean = 0;
    let bob = Math.sin(this.time * 1.8) * 0.008; // дыхание
    armL.rotation.z = -0.07;
    armR.rotation.z = 0.07;
    legL.rotation.x = 0;
    legR.rotation.x = 0;

    if (p.inWater) {
      // Плавание: руки гребут по очереди, ноги быстро «ножницами», корпус наклонён.
      this.walkPhase += dt * 8;
      armSwing = Math.sin(this.walkPhase) * 1.35;
      armL.rotation.x = armSwing;
      armR.rotation.x = -armSwing;
      legL.rotation.x = Math.sin(this.walkPhase * 1.4) * 0.4;
      legR.rotation.x = -legL.rotation.x;
      lean = -0.5;
      bob = Math.sin(this.time * 2.4) * 0.03;
    } else if (p.flying) {
      // Парение: руки слегка назад, ноги вытянуты, лёгкое покачивание.
      armL.rotation.x = 0.3 + Math.sin(this.time * 2) * 0.05;
      armR.rotation.x = 0.3 - Math.sin(this.time * 2) * 0.05;
      legL.rotation.x = 0.12;
      legR.rotation.x = -0.06;
      lean = -0.08;
      bob = Math.sin(this.time * 2) * 0.035;
    } else if (!p.onGround) {
      // Прыжок/падение: руки в стороны, ноги согнуты по-разному.
      const falling = p.vy < -2;
      armL.rotation.z = falling ? -0.85 : -0.45;
      armR.rotation.z = falling ? 0.85 : 0.45;
      armL.rotation.x = falling ? -0.35 : -0.2;
      armR.rotation.x = falling ? -0.35 : 0.15;
      legL.rotation.x = falling ? 0.25 : -0.55;
      legR.rotation.x = falling ? -0.2 : 0.3;
      lean = falling ? 0.04 : -0.06;
    } else if (this.smoothSpeed > 0.15) {
      // Ходьба/бег: фаза шага от реальной скорости, амплитуда растёт со скоростью.
      this.walkPhase += dt * (3 + this.smoothSpeed * 1.9);
      const amp = Math.min(1, this.smoothSpeed / 4.3) * 0.72;
      legSwing = Math.sin(this.walkPhase) * amp;
      armSwing = Math.sin(this.walkPhase) * amp * 0.8;
      legL.rotation.x = legSwing;
      legR.rotation.x = -legSwing;
      armL.rotation.x = -armSwing;
      armR.rotation.x = armSwing;
      lean = this.smoothSpeed > 5 ? -0.14 : -0.05;
      bob = Math.abs(Math.sin(this.walkPhase)) * 0.045 * Math.min(1, this.smoothSpeed / 4.3);
    } else {
      armL.rotation.x = Math.sin(this.time * 1.8) * 0.045;
      armR.rotation.x = -Math.sin(this.time * 1.8) * 0.045;
    }

    // Взмах правой рукой поверх обычной анимации (добыча/удар/установка).
    if (this.actionTime !== Number.POSITIVE_INFINITY) {
      this.actionTime += dt;
      const dur = 0.38;
      if (this.actionTime >= dur) {
        this.actionTime = Number.POSITIVE_INFINITY;
      } else {
        const k = this.actionTime / dur;
        armR.rotation.x = -0.25 + Math.sin(k * Math.PI) * 1.85;
        armR.rotation.z = 0.07 + Math.sin(k * Math.PI) * 0.15;
      }
    }

    this.body.position.y = bob;
    this.body.rotation.x = lean;
    this.body.rotation.z = p.onGround && this.smoothSpeed > 0.15
      ? Math.sin(this.walkPhase) * 0.025
      : 0;
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
