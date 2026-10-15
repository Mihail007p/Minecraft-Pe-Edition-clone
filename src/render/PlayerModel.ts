// Детальная пиксельная модель игрока для вида от третьего лица.
//
// Модель собрана только из процедурных текстур (DataTexture) и боксов —
// без внешних файлов и ассетов Mojang. Пропорции повторяют физику игрока:
// рост 1.8 блока, глаза на 1.62. Вперёд у модели — локальный −Z, поэтому
// root.rotation.y = yaw игрока сразу ставит её по взгляду.
//
// Анимации: ходьба/бег с махами рук и ног от пройденной фазы, дыхание на месте,
<<<<<<< HEAD
// прыжок и падение, плавание как у человека (кроль с креном и дыханием, стойка на воде
// со скуллингом и «яйцебитером», нырок «стрелой» — см. SwimPose.ts), парение в полёте,
// взмах правой рукой при добыче/установке блока и моргание.
=======
// прыжок и падение, плавание кролем по биомеханике (полный круг рук с высоким
// локтем при проносе, шестиудорный флаттер от бедра, крен плеч), парение в
// полёте, взмах правой рукой при добыче/установке блока и моргание.
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
//
// Знаки суставов: вперёд модели — локальный −Z, поэтому отрицательный
// rotation.x сгибает колено назад (пятка поднимается), а положительный
// rotation.x сгибает локоть вперёд — оба так, как сгибаются у человека.

import {
<<<<<<< HEAD
  BoxGeometry, DataTexture, Euler, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  NearestFilter, Quaternion, RGBAFormat, SRGBColorSpace, Vector3, type Material, type Texture,
=======
  BoxGeometry, DataTexture, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial,
  NearestFilter, RGBAFormat, SRGBColorSpace, type Material, type Texture,
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
} from 'three';
import {
  PLAYER_EYE_HEIGHT, THIRD_PERSON_DISTANCE, THIRD_PERSON_HEIGHT, type CameraView,
} from '../config.ts';
import { AIR, BLOCKS, faceTexture as blockFaceTexture } from '../world/Blocks.ts';
<<<<<<< HEAD
import { HIP_HEIGHT, SwimAnimator, type LimbTarget, type SwimPose, type Vec3 } from './SwimPose.ts';
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
import { TEX_SIZE, getTexturePixels } from './textures.ts';

/** Всё, что модели нужно знать об игроке на кадр (структурно совместимо с Player). */
export interface PlayerPoseSource {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  vx: number; vy: number; vz: number;
  onGround: boolean;
  flying: boolean;
  inWater: boolean;
<<<<<<< HEAD
  /** Голова под водой (если не передано — над водой). */
  headInWater?: boolean;
  /** Высота поверхности воды над игроком; null или не передано — неизвестна. */
  waterSurfaceY?: number | null;
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
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

type EyePose = 'open' | 'half' | 'closed';

function faceTexture(eyePose: EyePose): Pix {
  const t = new Pix(32);
  t.fill(SKIN, 0.05);
  // Свет на лбу, мягкая тень по краям лица и под скулами.
  t.rect(2, 0, 28, 6, SKIN_LIGHT);
  t.rect(0, 8, 3, 17, shade(SKIN, 0.94));
  t.rect(29, 8, 3, 17, shade(SKIN, 0.94));
  t.rect(3, 24, 26, 5, shade(SKIN, 0.93));
  t.rect(10, 29, 12, 2, shade(SKIN_DARK, 1.08));
  // Щёки, лёгкий румянец и несколько веснушек для живого лица.
  t.rect(3, 19, 5, 4, shade(SKIN, 1.06));
  t.rect(24, 19, 5, 4, shade(SKIN, 1.06));
  for (const [x, y] of [[5, 20], [7, 22], [25, 21], [27, 20]] as const) {
    t.set(x, y, shade(SKIN_DARK, 1.08));
  }
  // Брови и складки над глазами.
  t.rect(7, 10, 7, 2, HAIR);
  t.rect(18, 10, 7, 2, HAIR);
  t.rect(8, 12, 5, 1, shade(SKIN_DARK, 1.05));
  t.rect(19, 12, 5, 1, shade(SKIN_DARK, 1.05));

  for (const ex of [8, 19]) {
    if (eyePose === 'open') {
      t.rect(ex, 14, 5, 5, rgb(0xf7f3e8)); // белок
      t.rect(ex + 1, 15, 3, 4, rgb(0x5b3a1e)); // радужка
      t.rect(ex + 2, 16, 2, 2, rgb(0x17100b)); // зрачок
      t.set(ex + 1, 15, rgb(0xffffff)); // блик
      t.rect(ex, 19, 5, 1, SKIN_DARK); // нижнее веко
    } else if (eyePose === 'half') {
      // Верхнее веко опускается, но часть радужки ещё видна.
      t.rect(ex, 14, 5, 2, SKIN_LIGHT);
      t.rect(ex, 16, 5, 3, rgb(0xf7f3e8));
      t.rect(ex + 1, 16, 3, 3, rgb(0x5b3a1e));
      t.rect(ex + 2, 17, 2, 2, rgb(0x17100b));
      t.rect(ex, 19, 5, 1, SKIN_DARK);
    } else {
      // Закрытые веки — тёплая линия ресниц и светлая складка под ней.
      t.rect(ex, 16, 5, 1, SKIN_DARK);
      t.rect(ex + 1, 17, 3, 1, SKIN_LIGHT);
    }
  }

  // Нос, фильтрум и рот с небольшой тенью под нижней губой.
  t.rect(14, 17, 2, 5, shade(SKIN, 0.92));
  t.rect(16, 19, 2, 4, SKIN_LIGHT);
  t.rect(14, 22, 4, 1, SKIN_DARK);
  t.rect(13, 24, 6, 1, shade(SKIN_DARK, 1.08));
  t.rect(12, 25, 8, 1, rgb(0x8a5638));
  t.rect(13, 26, 6, 1, rgb(0xb96d59));
  t.rect(14, 27, 4, 1, shade(SKIN, 0.92));
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

function hairPanelTexture(): Pix {
  const t = new Pix(16);
  t.fill(HAIR, 0.1);
  for (let x = 2; x < 16; x += 4) {
    t.rect(x, 1 + (x % 3), 1, 12, HAIR_LIGHT);
    t.set(x + 1, 8 + (x % 4), shade(HAIR, 1.22));
  }
  t.rect(0, 14, 16, 2, shade(HAIR, 0.82));
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

function skinTexture(part: 'base' | 'forearm' | 'neck' = 'base'): Pix {
  const t = new Pix(16);
  t.fill(SKIN, 0.06);
  t.rect(0, 0, 16, 2, SKIN_LIGHT);
  t.rect(0, 14, 16, 2, shade(SKIN, 0.9));
  if (part === 'forearm') {
    t.rect(2, 3, 2, 9, SKIN_LIGHT); // мягкий блик по внешней стороне руки
    t.rect(11, 5, 2, 7, shade(SKIN, 0.94));
    t.rect(4, 11, 7, 1, SKIN_DARK); // складка запястья
  } else if (part === 'neck') {
    t.rect(1, 2, 3, 12, shade(SKIN, 0.88));
    t.rect(11, 2, 3, 12, SKIN_LIGHT);
  }
  return t;
}

function handTexture(): Pix {
  const t = new Pix(16);
  t.fill(SKIN, 0.06);
  t.rect(1, 2, 14, 3, SKIN_LIGHT); // костяшки
  t.rect(2, 7, 12, 1, shade(SKIN_DARK, 1.04));
  t.rect(3, 9, 10, 1, shade(SKIN, 0.9)); // складки ладони
  t.rect(4, 12, 8, 1, SKIN_DARK);
  return t;
}

// ------------------------------------------------------------------ модель

interface PartRefs {
  head: Group;
<<<<<<< HEAD
  torso: Group;
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
  armL: Group;
  armR: Group;
  elbowL: Group;
  elbowR: Group;
  legL: Group;
  legR: Group;
  kneeL: Group;
  kneeR: Group;
<<<<<<< HEAD
  shoeL: Group;
  shoeR: Group;
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const DOWN = new Vector3(0, -1, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const aimU = new Vector3();
const aimF = new Vector3();
const aimPerp = new Vector3();
const aimBend = new Vector3();
const aimSide = new Vector3();
const aimDir = new Quaternion();
const aimTwist = new Quaternion();

/**
 * Повернуть конечность так, чтобы плечо (бедро) смотрело вдоль upper, а предплечье (голень) — вдоль lower.
 * Записывает в out поворот сустава у плеча (бедра) и возвращает угол сгиба локтя (колена) в радианах.
 * Локоть сгибается предплечьем к −Z звена (rotation.x > 0), колено — к +Z (rotation.x < 0): bendSign = −1 / +1.
 */
export function aimLimb(upper: Vec3, lower: Vec3, bendSign: -1 | 1, out: Quaternion): number {
  aimU.set(upper[0], upper[1], upper[2]).normalize();
  aimF.set(lower[0], lower[1], lower[2]).normalize();
  aimDir.setFromUnitVectors(DOWN, aimU);
  const cosFlex = Math.min(1, Math.max(-1, aimU.dot(aimF)));
  // Плоскость сгиба задаётся самими звеньями: докручиваем плечо вокруг его оси так, чтобы сгиб смотрел в нужную сторону.
  aimPerp.copy(aimF).addScaledVector(aimU, -cosFlex);
  let twist = 0;
  if (aimPerp.lengthSq() > 1e-8) {
    aimPerp.normalize();
    aimBend.set(0, 0, bendSign).applyQuaternion(aimDir);
    aimSide.set(1, 0, 0).applyQuaternion(aimDir);
    twist = Math.atan2(bendSign * aimPerp.dot(aimSide), aimPerp.dot(aimBend));
  }
  aimTwist.setFromAxisAngle(AXIS_Y, twist);
  out.copy(aimDir).multiply(aimTwist);
  return Math.acos(cosFlex);
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
}

/** Детальная модель игрока: голова с лицом и причёской, одежда, рюкзак, анимации. */
export class PlayerModel {
  readonly root = new Group();
<<<<<<< HEAD
  /** Группа тела вращается вокруг таза; её дочерний rig возвращает части на их места. */
  private body = new Group();
  private rig = new Group();
  private swim = new SwimAnimator();
  private readonly swimQuat = new Quaternion();
  private readonly swingQuat = new Quaternion();
  private readonly swingEuler = new Euler();
  private readonly landEuler = new Euler();
  private readonly landHip = new Vector3();
  private heldWanted = false;
=======
  private body = new Group();
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
  private parts: PartRefs;
  private headMesh: Mesh;
  private heldMesh!: Mesh;
  private heldBlockId = -1;
  private headMatsOpen: Material[];
  private headMatsHalf: Material[];
  private headMatsClosed: Material[];
  private geometry: BoxGeometry;
  private materials = new Set<Material>();
  private textures = new Set<Texture>();

  private time = 0;
  private walkPhase = 0;
<<<<<<< HEAD
=======
  private swimPhase = 0;
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
  private smoothSpeed = 0;
  private actionTime = Number.POSITIVE_INFINITY;
  private blinkLeft = 0;
  private nextBlink = 1.8;
  private blinkCount = 0;
  private readonly blinkDuration = 0.16;

  constructor() {
    this.geometry = new BoxGeometry(1, 1, 1);
    const normals = this.geometry.getAttribute('normal');
    const colors: number[] = [];
    for (let i = 0; i < normals.count; i++) {
      const shadeF = normals.getY(i) > 0 ? 1 : normals.getY(i) < 0 ? 0.55 : normals.getX(i) !== 0 ? 0.78 : 0.9;
      colors.push(shadeF, shadeF, shadeF);
    }
    this.geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.body.name = 'animated-body';
<<<<<<< HEAD
    this.body.position.y = HIP_HEIGHT;
    this.rig.name = 'body-rig';
    this.rig.position.y = -HIP_HEIGHT;
    this.body.add(this.rig);
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
    this.root.add(this.body);
    this.root.name = 'player-model';

    // --- Материалы ---
    const faceOpen = this.texMat(faceTexture('open'));
    const faceHalf = this.texMat(faceTexture('half'));
    const faceClosed = this.texMat(faceTexture('closed'));
    const headSide = this.texMat(headSideTexture());
    const headBack = this.texMat(headBackTexture());
    const hairTop = this.texMat(hairTopTexture());
    const skinMat = this.texMat(skinTexture());
    const neckMat = this.texMat(skinTexture('neck'));
    const forearmMat = this.texMat(skinTexture('forearm'));
    // Порядок граней BoxGeometry: +X, −X, +Y, −Y, +Z(спина), −Z(лицо).
    this.headMatsOpen = [headSide, headSide, hairTop, skinMat, headBack, faceOpen];
    this.headMatsHalf = [headSide, headSide, hairTop, skinMat, headBack, faceHalf];
    this.headMatsClosed = [headSide, headSide, hairTop, skinMat, headBack, faceClosed];
    const torsoFront = this.texMat(torsoTexture(false));
    const torsoBack = this.texMat(torsoTexture(true));
    const shirtSide = this.texMat(sleeveTexture());
    const torsoMats = [shirtSide, shirtSide, this.solid(SHIRT_DARK), this.solid(SHIRT_DARK), torsoBack, torsoFront];
    const sleeveMat = this.texMat(sleeveTexture());
    const pantsMat = this.texMat(pantsTexture());
    const handMat = this.texMat(handTexture());
    const hairPanelMat = this.texMat(hairPanelTexture());
    const hairMat = this.solid(HAIR);
    const hairLightMat = this.solid(HAIR_LIGHT);

    // --- Ноги: отдельные колено, голень и ботинок для живого шага ---
<<<<<<< HEAD
    const makeLeg = (side: -1 | 1): { leg: Group; knee: Group; shoe: Group } => {
=======
    const makeLeg = (side: -1 | 1): { leg: Group; knee: Group } => {
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
      const leg = new Group();
      leg.name = side < 0 ? 'leg-left' : 'leg-right';
      leg.position.set(side * 0.13, 0.68, 0);
      this.box(leg, pantsMat, [0.24, 0.37, 0.27], [0, -0.185, 0], 'thigh');
      this.box(leg, this.solid(PANTS_DARK), [0.245, 0.055, 0.28], [0, -0.35, 0], 'knee-seam');

      const knee = new Group();
      knee.name = side < 0 ? 'knee-left' : 'knee-right';
      knee.position.set(0, -0.36, 0);
      leg.add(knee);
      this.box(knee, pantsMat, [0.22, 0.28, 0.24], [0, -0.14, 0], 'shin');
      this.box(knee, this.solid(PANTS_DARK), [0.23, 0.07, 0.25], [0, -0.265, 0], 'cuff');
      this.box(knee, this.solid(0x4659a8), [0.13, 0.09, 0.014], [0, -0.13, -0.124], 'kneepad');
      this.box(knee, this.solid(0x7482c2), [0.09, 0.012, 0.01], [0, -0.09, -0.134], 'kneepad-seam');

      const shoe = new Group();
      shoe.name = 'shoe';
      shoe.position.set(0, -0.26, 0);
      this.box(shoe, this.solid(0x2e2a26), [0.27, 0.07, 0.44], [0, -0.025, -0.04], 'sole');
      this.box(shoe, this.solid(0x4a423a), [0.25, 0.13, 0.38], [0, 0.045, -0.035], 'shoe-body');
      this.box(shoe, this.solid(0x6b5d4f), [0.25, 0.09, 0.14], [0, 0.035, -0.18], 'toe');
      this.box(shoe, this.solid(0x37312c), [0.22, 0.06, 0.2], [0, 0.11, 0.035], 'ankle-collar');
      this.box(shoe, this.solid(0xe8e2d4), [0.16, 0.022, 0.035], [0, 0.12, -0.11], 'lace-1');
      this.box(shoe, this.solid(0xe8e2d4), [0.16, 0.022, 0.035], [0, 0.12, -0.045], 'lace-2');
      this.box(shoe, this.solid(0xe8e2d4), [0.16, 0.022, 0.035], [0, 0.12, 0.02], 'lace-3');
      knee.add(shoe);
<<<<<<< HEAD
      this.rig.add(leg);
      return { leg, knee, shoe };
    };
    const { leg: legL, knee: kneeL, shoe: shoeL } = makeLeg(-1);
    const { leg: legR, knee: kneeR, shoe: shoeR } = makeLeg(1);
=======
      this.body.add(leg);
      return { leg, knee };
    };
    const { leg: legL, knee: kneeL } = makeLeg(-1);
    const { leg: legR, knee: kneeR } = makeLeg(1);
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone

    // --- Торс, куртка и туристический рюкзак ---
    const torso = new Group();
    torso.name = 'torso';
<<<<<<< HEAD
    torso.position.set(0, HIP_HEIGHT, 0);
    this.rig.add(torso);
=======
    torso.position.set(0, 0.68, 0);
    this.body.add(torso);
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
    this.box(torso, torsoMats, [0.52, 0.66, 0.28], [0, 0.33, 0], 'chest');
    this.box(torso, this.solid(0x6e4a26), [0.54, 0.09, 0.3], [0, 0.05, 0], 'belt');
    this.box(torso, this.solid(0xf2c14e), [0.14, 0.07, 0.02], [0, 0.05, -0.16], 'buckle');
    // Кант куртки, пуговицы, значок и ремни рюкзака спереди.
    this.box(torso, this.solid(SHIRT_DARK), [0.022, 0.4, 0.014], [0.075, 0.31, -0.15], 'jacket-seam');
    for (const [i, y] of [0.17, 0.29, 0.53].entries()) {
      this.box(torso, this.solid(ACCENT), [0.026, 0.026, 0.018], [0.045, y, -0.158], `button-${i + 1}`);
    }
    const emblem = this.box(torso, this.solid(ACCENT), [0.13, 0.13, 0.02], [0, 0.42, -0.15], 'emblem');
    emblem.rotation.z = Math.PI / 4;
    this.box(torso, this.solid(SHIRT_DARK), [0.07, 0.5, 0.02], [-0.17, 0.36, -0.15], 'strap-left');
    this.box(torso, this.solid(SHIRT_DARK), [0.07, 0.5, 0.02], [0.17, 0.36, -0.15], 'strap-right');
    const pack = new Group();
    pack.name = 'backpack';
    pack.position.set(0, 0.35, 0.24);
    this.box(pack, this.solid(0x8a6742), [0.4, 0.5, 0.18], [0, 0, 0], 'pack-body');
    this.box(pack, this.solid(0x6e4f30), [0.42, 0.16, 0.2], [0, 0.2, 0], 'pack-flap');
    this.box(pack, this.solid(0xa67c4e), [0.28, 0.2, 0.04], [0, -0.1, 0.1], 'pack-pocket');
    this.box(pack, this.solid(0xf2c14e), [0.1, 0.06, 0.02], [0, 0.2, -0.1], 'pack-clasp');
    this.box(pack, this.solid(SHIRT), [0.44, 0.13, 0.13], [0, 0.35, 0], 'bedroll');
    this.box(pack, this.solid(0x54381e), [0.44, 0.05, 0.05], [0, -0.27, 0], 'pack-strap');
    torso.add(pack);
    this.box(torso, neckMat, [0.18, 0.14, 0.18], [0, 0.69, 0], 'neck');
    this.box(torso, this.solid(SHIRT_DARK), [0.34, 0.07, 0.3], [0, 0.66, 0], 'collar');

    // --- Руки: рукав, сгибающийся локоть, предплечье и пальцы ---
    const makeArm = (side: -1 | 1): { arm: Group; elbow: Group } => {
      const arm = new Group();
      arm.name = side < 0 ? 'arm-left' : 'arm-right';
      arm.position.set(side * 0.36, 0.61, 0);
      this.box(arm, sleeveMat, [0.22, 0.3, 0.24], [0, -0.15, 0], 'sleeve');
      this.box(arm, sleeveMat, [0.25, 0.12, 0.25], [0, -0.035, 0], 'shoulder-cap');

      const elbow = new Group();
      elbow.name = side < 0 ? 'elbow-left' : 'elbow-right';
      elbow.position.set(0, -0.285, 0);
      arm.add(elbow);
      this.box(elbow, forearmMat, [0.19, 0.27, 0.2], [0, -0.135, 0], 'forearm');
      this.box(elbow, this.solid(SHIRT_DARK), [0.21, 0.055, 0.22], [0, -0.02, 0], 'sleeve-cuff');
      if (side < 0) this.box(elbow, this.solid(ACCENT), [0.22, 0.065, 0.23], [0, -0.245, 0], 'wristband');

      const hand = new Group();
      hand.name = side < 0 ? 'hand-left' : 'hand-right';
      hand.position.set(0, -0.27, 0);
      this.box(hand, handMat, [0.18, 0.12, 0.13], [0, -0.045, -0.015], 'hand');
      for (let i = 0; i < 4; i++) {
        const x = (i - 1.5) * 0.038;
        this.box(hand, skinMat, [0.027, 0.085 - Math.abs(i - 1.5) * 0.008, 0.035],
          [x, -0.125, -0.035], `finger-${side < 0 ? 'left' : 'right'}-${i + 1}`);
      }
      this.box(hand, skinMat, [0.045, 0.09, 0.05], [-side * 0.095, -0.035, -0.025], 'thumb');
      if (side > 0) {
        // Выбранный блок лежит перед ладонью и движется вместе с рукой.
        this.heldMesh = this.box(hand, this.solid(0x000000), [0.25, 0.25, 0.25], [0, -0.12, -0.17], 'held-item');
        this.heldMesh.rotation.set(0.15, 0.5, 0);
        this.heldMesh.visible = false;
      }
      elbow.add(hand);
      torso.add(arm);
      return { arm, elbow };
    };
    const { arm: armL, elbow: elbowL } = makeArm(-1);
    const { arm: armR, elbow: elbowR } = makeArm(1);

    // --- Голова: компактные человеческие пропорции, лицо, уши и рельефный нос ---
    const head = new Group();
    head.name = 'head';
    head.position.set(0, 0.71, 0);
    torso.add(head);
    this.headMesh = this.box(head, this.headMatsOpen, [0.42, 0.42, 0.4], [0, 0.2, 0], 'skull');
    const hairCoverMats = [hairPanelMat, hairPanelMat, hairTop, hairMat, hairPanelMat, hairPanelMat];
    this.box(head, hairCoverMats, [0.46, 0.05, 0.43], [0, 0.405, 0], 'hair-top');
    this.box(head, hairPanelMat, [0.44, 0.28, 0.075], [0, 0.25, 0.19], 'hair-back');
    this.box(head, hairPanelMat, [0.075, 0.28, 0.4], [-0.205, 0.25, 0], 'hair-left');
    this.box(head, hairPanelMat, [0.075, 0.28, 0.4], [0.205, 0.25, 0], 'hair-right');
    this.box(head, hairPanelMat, [0.45, 0.09, 0.075], [0, 0.345, -0.19], 'fringe');
    const teeth = [-0.15, -0.05, 0.05, 0.15];
    teeth.forEach((x, i) => {
      this.box(head, i % 2 ? hairLightMat : hairMat, [0.09, 0.075 + (i % 2) * 0.025, 0.08],
        [x, 0.29, -0.197], `fringe-tooth-${i}`);
    });
    for (const side of [-1, 1] as const) {
      this.box(head, skinMat, [0.06, 0.12, 0.11], [side * 0.225, 0.17, 0], side < 0 ? 'ear-left' : 'ear-right');
      this.box(head, this.solid(SKIN_DARK), [0.018, 0.055, 0.055], [side * 0.252, 0.17, -0.035],
        side < 0 ? 'ear-inner-left' : 'ear-inner-right');
    }
    this.box(head, this.solid(SKIN_LIGHT), [0.05, 0.1, 0.055], [0, 0.195, -0.208], 'nose-bridge');
    this.box(head, this.solid(SKIN), [0.07, 0.055, 0.075], [0, 0.15, -0.238], 'nose-tip');
    this.box(head, this.solid(SKIN_DARK), [0.038, 0.012, 0.012], [0, 0.119, -0.275], 'nose-shadow');

<<<<<<< HEAD
    this.parts = { head, torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR, shoeL, shoeR };
=======
    this.parts = { head, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR };
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
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
<<<<<<< HEAD
      this.heldWanted = false;
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
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
<<<<<<< HEAD
    this.heldWanted = true;
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
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
<<<<<<< HEAD

    const speed = Math.hypot(p.vx, p.vz);
    this.smoothSpeed += (speed - this.smoothSpeed) * (1 - Math.exp(-10 * dt));
    // Плавание ведёт отдельный аниматор: он же задаёт курс, наклон корпуса и посадку на воду.
    const swimming = p.inWater && !p.onGround && !p.flying;
    const swim = this.swim.update(dt, {
      y: p.y, vx: p.vx, vy: p.vy, vz: p.vz, yaw: p.yaw, pitch: p.pitch, swimming,
      headInWater: p.headInWater, waterSurface: p.waterSurfaceY,
    });
    const sw = swim.weight;
    this.root.rotation.y = p.yaw + swim.headingOffset * sw;
    const { head, torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR, shoeL, shoeR } = this.parts;
=======
    this.root.rotation.y = p.yaw;

    const speed = Math.hypot(p.vx, p.vz);
    this.smoothSpeed += (speed - this.smoothSpeed) * (1 - Math.exp(-10 * dt));
    const swimming = p.inWater && !p.onGround && !p.flying;
    const swimMotion = Math.max(this.smoothSpeed, Math.abs(p.vy) * 0.55);
    const swimEffort = swimming ? Math.min(1, swimMotion / 2.5) : 0;
    const { head, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR } = this.parts;
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone

    // Моргание проходит тремя фазами: веки опускаются, закрываются и плавно открываются.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0 && this.blinkLeft <= 0) {
      this.blinkLeft = this.blinkDuration;
      const noise = Math.sin((this.blinkCount + 1) * 12.9898 + this.time * 78.233) * 43758.5453;
      this.nextBlink = 2 + (noise - Math.floor(noise)) * 3;
      this.blinkCount++;
    }
    let faceMats = this.headMatsOpen;
    if (this.blinkLeft > 0) {
      const progress = 1 - this.blinkLeft / this.blinkDuration;
      faceMats = progress < 0.28 || progress > 0.72 ? this.headMatsHalf : this.headMatsClosed;
      this.blinkLeft = Math.max(0, this.blinkLeft - dt);
    }
    this.headMesh.material = faceMats;

<<<<<<< HEAD
    // Поза каждый кадр собирается заново: после плавания в суставах не остаётся лишних поворотов.
    for (const joint of [head, torso, armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR, shoeL, shoeR]) {
      joint.rotation.set(0, 0, 0);
    }

    // Голова следует за наклоном взгляда.
    const landHeadPitch = p.pitch * 0.85;
    head.rotation.x = landHeadPitch;
=======
    // Голова следует за наклоном взгляда и чуть поднимается, когда тело вытянуто для плавания.
    head.rotation.x = p.pitch * 0.85 + (swimming ? 0.2 : 0);
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
    head.rotation.z = Math.sin(this.time * 0.7) * 0.01;

    let legSwing = 0;
    let armSwing = 0;
    let elbowLFlex = 0.06;
    let elbowRFlex = 0.06;
    let kneeLFlex = 0;
    let kneeRFlex = 0;
    let lean = 0;
<<<<<<< HEAD
    let bob = Math.sin(this.time * 1.8) * 0.008; // дыхание
    armL.rotation.z = -0.07;
    armR.rotation.z = 0.07;
=======
    let swimRoll = 0;
    let bob = Math.sin(this.time * 1.8) * 0.008; // дыхание
    armL.rotation.z = -0.07;
    armR.rotation.z = 0.07;
    legL.rotation.x = 0;
    legR.rotation.x = 0;
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone

    if (p.flying) {
      // Парение: руки слегка назад, ноги вытянуты, лёгкое покачивание.
      armL.rotation.x = 0.3 + Math.sin(this.time * 2) * 0.05;
      armR.rotation.x = 0.3 - Math.sin(this.time * 2) * 0.05;
      elbowLFlex = 0.12;
      elbowRFlex = 0.12;
      lean = -0.08;
      bob = Math.sin(this.time * 2) * 0.035;
      kneeLFlex = -0.05;
      kneeRFlex = -0.05;
<<<<<<< HEAD
    } else if (!p.onGround) {
      // Прыжок/падение: руки в стороны, ноги согнуты по-разному. Пловец стартует отсюда и плавно
      // переходит в позу пловца (SwimPose), поэтому при входе в воду поза не «подпрыгивает».
=======
    } else if (swimming) {
      // Кроль по биомеханике: тело вытянуто горизонтально, руки описывают
      // полный круг попеременно — одна тянет под водой, вторая в это время
      // проносится над водой с высоким локтем. Ноги делают шестиудорный
      // флаттер от бедра строго в противофазе (одна вверх — другая вниз),
      // колено сгибается назад в начале удара вниз и выпрямляется к его
      // концу, а плечи катятся вдоль продольной оси в сторону гребущей руки.
      this.swimPhase += dt * (2.4 + swimEffort * 3.8);
      const phaseL = this.swimPhase;
      const phaseR = this.swimPhase + Math.PI;

      if (swimEffort > 0.12) {
        const armAngle = (phase: number) => 0.9 + 1.35 * Math.sin(phase) * swimEffort;
        armL.rotation.x = armAngle(phaseL);
        armR.rotation.x = armAngle(phaseR);
        // Высокий локоть при проносе (угол руки растёт), ровная рука при гребке.
        elbowLFlex = 0.35 + 0.95 * Math.max(0, Math.cos(phaseL)) * swimEffort;
        elbowRFlex = 0.35 + 0.95 * Math.max(0, Math.cos(phaseR)) * swimEffort;
        // Шестиудорный флаттер: три удара каждой ногой за цикл рук.
        const kickL = 3 * phaseL;
        const kickR = 3 * phaseR;
        legL.rotation.x = 0.04 + Math.sin(kickL) * 0.22 * swimEffort;
        legR.rotation.x = 0.04 + Math.sin(kickR) * 0.22 * swimEffort;
        // Колено сгибается назад (пятка поднимается) в начале удара вниз.
        kneeLFlex = -(0.05 + 0.45 * Math.max(0, Math.cos(kickL + 0.25)) * swimEffort);
        kneeRFlex = -(0.05 + 0.45 * Math.max(0, Math.cos(kickR + 0.25)) * swimEffort);
      } else {
        // На месте персонаж спокойно держится на воде: редкие ножные удары
        // в противофазе и короткие гребки-«пропеллеры» руками.
        const tread = Math.sin(this.time * 2.2);
        armL.rotation.x = 0.08 + tread * 0.06;
        armR.rotation.x = 0.08 - tread * 0.06;
        legL.rotation.x = Math.sin(this.time * 3.1) * 0.055;
        legR.rotation.x = -Math.sin(this.time * 3.1) * 0.055;
        elbowLFlex = 0.12;
        elbowRFlex = 0.12;
        kneeLFlex = -0.035;
        kneeRFlex = -0.035;
      }

      lean = -0.72 - 0.28 * swimEffort;
      // Крен в сторону руки, которая сейчас тянет под водой (угол уменьшается).
      swimRoll = -0.06 * Math.cos(phaseL) * swimEffort;
      // Поднимаем модель относительно ног: голова остаётся у поверхности, а не уходит под воду.
      bob = 0.55 + Math.sin(this.time * 2.4) * (0.012 + 0.012 * swimEffort);
    } else if (!p.onGround) {
      // Прыжок/падение: руки в стороны, ноги согнуты по-разному.
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
      const falling = p.vy < -2;
      armL.rotation.z = falling ? -0.85 : -0.45;
      armR.rotation.z = falling ? 0.85 : 0.45;
      armL.rotation.x = falling ? -0.35 : -0.2;
      armR.rotation.x = falling ? -0.35 : 0.15;
      elbowLFlex = falling ? 0.28 : 0.18;
      elbowRFlex = falling ? 0.28 : 0.18;
      legL.rotation.x = falling ? 0.25 : -0.55;
      legR.rotation.x = falling ? -0.2 : 0.3;
      // Колени сгибаются назад — поджимаем пятки, а не «птичьи» ноги вперёд.
      kneeLFlex = falling ? -0.1 : -0.24;
      kneeRFlex = falling ? -0.1 : -0.18;
      lean = falling ? 0.04 : -0.06;
    } else if (this.smoothSpeed > 0.15) {
      // На суше — обычный шаг; стоя на дне — более короткие и медленные шаги в воде.
      const wading = p.inWater;
      const strideScale = wading ? 0.62 : 1;
      this.walkPhase += dt * (3 + this.smoothSpeed * 1.9) * (wading ? 0.82 : 1);
      const amp = Math.min(1, this.smoothSpeed / 4.3) * 0.72 * strideScale;
      legSwing = Math.sin(this.walkPhase) * amp;
      armSwing = Math.sin(this.walkPhase) * amp * 0.8;
      legL.rotation.x = legSwing;
      legR.rotation.x = -legSwing;
      armL.rotation.x = -armSwing;
      armR.rotation.x = armSwing;
      elbowLFlex = 0.08 + Math.abs(armSwing) * 0.18;
      elbowRFlex = 0.08 + Math.abs(armSwing) * 0.18;
      // Колено сгибается назад, когда нога позади корпуса: поднимается пятка.
      kneeLFlex = -Math.max(0, -legSwing) * 0.58;
      kneeRFlex = -Math.max(0, legSwing) * 0.58;
      lean = wading ? -0.015 : this.smoothSpeed > 5 ? -0.14 : -0.05;
      bob = Math.abs(Math.sin(this.walkPhase)) * 0.045 * Math.min(1, this.smoothSpeed / 4.3) * (wading ? 0.45 : 1);
    } else {
      armL.rotation.x = Math.sin(this.time * 1.8) * 0.045;
      armR.rotation.x = -Math.sin(this.time * 1.8) * 0.045;
    }

    // Взмах правой рукой поверх обычной анимации (добыча/удар/установка).
<<<<<<< HEAD
    let swing = -1;
=======
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
    if (this.actionTime !== Number.POSITIVE_INFINITY) {
      this.actionTime += dt;
      const dur = 0.38;
      if (this.actionTime >= dur) {
        this.actionTime = Number.POSITIVE_INFINITY;
      } else {
<<<<<<< HEAD
        swing = Math.sin((this.actionTime / dur) * Math.PI);
        armR.rotation.x = -0.25 + swing * 1.85;
        armR.rotation.z = 0.07 + swing * 0.15;
        elbowRFlex = 0.18 + swing * 0.24;
=======
        const k = this.actionTime / dur;
        armR.rotation.x = -0.25 + Math.sin(k * Math.PI) * 1.85;
        armR.rotation.z = 0.07 + Math.sin(k * Math.PI) * 0.15;
        elbowRFlex = 0.18 + Math.sin(k * Math.PI) * 0.24;
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
      }
    }

    elbowL.rotation.x = elbowLFlex;
    elbowR.rotation.x = elbowRFlex;
    kneeL.rotation.x = kneeLFlex;
    kneeR.rotation.x = kneeRFlex;
<<<<<<< HEAD

    // --- Поза пловца поверх земной: суставы смешиваются по весу, корпус вращается вокруг таза ---
    if (sw > 0.002) {
      this.blendSwimLimbs(swim);
      const prone = swim.mix.crawl + swim.mix.dive;
      if (swing >= 0) {
        // Стоя на воде рука по-прежнему бьёт; в кроле и нырке она занята гребком.
        const overlay = 1 - sw * prone;
        this.swingQuat.setFromEuler(this.swingEuler.set(-0.25 + swing * 1.85, 0, 0.07 + swing * 0.15));
        armR.quaternion.slerp(this.swingQuat, overlay);
        elbowR.rotation.x += (0.18 + swing * 0.24 - elbowR.rotation.x) * overlay;
      }
      head.rotation.x = lerp(landHeadPitch, swim.headPitch, sw);
      head.rotation.y = sw * swim.headYaw;
      torso.rotation.y = sw * swim.shoulderTwist;
    }
    this.heldMesh.visible = this.heldWanted && !(sw > 0.5 && swim.handsFree);

    // Корпус: на суше наклон и крен идут вокруг ступней, как и раньше, а пловец вращается вокруг таза.
    // Тело повёрнуто вокруг таза, поэтому «земное» вращение вокруг ступней добавляет сдвиг самого таза.
    const landRoll = p.onGround && this.smoothSpeed > 0.15 ? Math.sin(this.walkPhase) * 0.025 : 0;
    this.landEuler.set(lean, 0, landRoll);
    this.landHip.set(0, HIP_HEIGHT, 0).applyEuler(this.landEuler);
    this.body.position.set(
      lerp(this.landHip.x, 0, sw),
      lerp(this.landHip.y + bob, HIP_HEIGHT + swim.lift + swim.bob, sw),
      lerp(this.landHip.z, 0, sw),
    );
    this.body.rotation.set(lerp(lean, swim.lean, sw), sw * swim.hipRoll, (1 - sw) * landRoll);
  }

  /** Смешать суставы рук и ног с позой пловца по её весу. */
  private blendSwimLimbs(swim: SwimPose): void {
    const w = swim.weight;
    const { armL, armR, elbowL, elbowR, legL, legR, kneeL, kneeR, shoeL, shoeR } = this.parts;
    const arm = (shoulder: Group, elbow: Group, target: LimbTarget): void => {
      const flex = aimLimb(target.upper, target.lower, -1, this.swimQuat);
      shoulder.quaternion.slerp(this.swimQuat, w);
      elbow.rotation.x += (flex - elbow.rotation.x) * w;
    };
    const leg = (hip: Group, knee: Group, shoe: Group, target: LimbTarget): void => {
      const flex = aimLimb(target.upper, target.lower, 1, this.swimQuat);
      hip.quaternion.slerp(this.swimQuat, w);
      knee.rotation.x += (-flex - knee.rotation.x) * w;
      shoe.rotation.x = -swim.footPlantar * w;
    };
    arm(armL, elbowL, swim.armL);
    arm(armR, elbowR, swim.armR);
    leg(legL, kneeL, shoeL, swim.legL);
    leg(legR, kneeR, shoeR, swim.legR);
=======
    this.body.position.y = bob;
    this.body.rotation.x = lean;
    this.body.rotation.z = swimming
      ? swimRoll
      : p.onGround && this.smoothSpeed > 0.15
        ? Math.sin(this.walkPhase) * 0.025
        : 0;
>>>>>>> origin/arena/51fc7917-minecraft-pe-edition-clone
  }

  dispose(): void {
    this.geometry.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.materials.clear();
    this.textures.clear();
  }
}
