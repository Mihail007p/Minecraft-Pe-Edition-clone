// Анимация плавания человека — чистая математика без three.js (тестируется в Node).
//
// Как плавает настоящий человек (изучено перед реализацией, ссылки — в README):
//  • Кроль. Тело почти горизонтально, голова в линии позвоночника, взгляд вниз-вперёд. Руки работают
//    по очереди и сдвинуты на 180°: пока одна гребёт под водой, другая переносится над водой.
//    Гребок: вход пальцами вперёд → захват с высоким локтем (предплечье вертикально, локоть 90–120°) →
//    подтягивание под грудь → выталкивание к бедру → вынос высоким локтем с расслабленной кистью.
//  • Тело вращается вокруг оси позвоночника на 35–50° в каждую сторону; плечи вращаются больше бёдер
//    и раньше них, а с ростом скорости крен бёдер уменьшается. Ноги бьют «флаттером» из бедра,
//    почти прямыми (колено гнётся лишь в начале удара вниз), в противофазе; в спринте — 6 ударов на цикл рук.
//  • Дыхание: голова не поднимается, а поворачивается вместе с креном («один глаз в воде, один над водой»),
//    обычно на каждый третий гребок — поочерёдно вправо и влево, а под водой пловец задерживает дыхание.
//  • На месте человек «стоит на воде»: вертикальный корпус, вода у шеи, кисти скуллируют восьмёрками,
//    ноги работают «яйцебитером» — голени поочерёдно описывают круги в противоположные стороны.
//  • Нырок головой вперёд: тело вытягивается вдоль траектории, руки сомкнуты над головой («стрела»),
//    ноги продолжают биться; при вертикальном нырке тело переворачивается вниз головой.
//
// Все углы — в системе координат корпуса: +X вправо, +Y вдоль позвоночника к голове (при вертикальной стойке
// вверх, при плавании лёжа — вперёд), −Z — грудь, +Z — спина. Конечность задаётся направлениями двух звеньев
// (плечо/предплечье или бедро/голень); PlayerModel превращает их в повороты суставов.

import { WATER_FLOAT_DEPTH, WATER_SWIM_SPEED } from '../config.ts';

export type Vec3 = [number, number, number];

export interface LimbTarget {
  /** Направление плеча (бедра) от сустава — единичный вектор. */
  upper: Vec3;
  /** Направление предплечья (голени) от локтя (колена) — единичный вектор. */
  lower: Vec3;
}

export interface SwimPose {
  /** 0..1 — доля позы пловца в итоговой анимации: растёт при входе в воду и падает при выходе. */
  weight: number;
  /** Доворот корпуса относительно взгляда игрока (рад): пловец смотрит туда, куда плывёт. */
  headingOffset: number;
  /** Наклон корпуса вокруг таза: 0 — стоя, −π/2 — горизонтально лицом вниз, −π — вниз головой. */
  lean: number;
  /** Крен таза вокруг оси позвоночника (+ — правый бок вниз). */
  hipRoll: number;
  /** Доворот плеч относительно таза вокруг позвоночника: плечи вращаются больше бёдер. */
  shoulderTwist: number;
  /** Подъём таза над физической позицией игрока (блоки): пловец «ложится» на воду. */
  lift: number;
  /** Покачивание корпуса на воде (блоки). */
  bob: number;
  /** Поворот головы относительно торса (рад, + — влево) и наклон (+ — вверх). */
  headYaw: number;
  headPitch: number;
  /** Вытянутость стопы вдоль голени (рад). */
  footPlantar: number;
  /** Руки заняты гребком: предмет из руки лучше спрятать. */
  handsFree: boolean;
  armL: LimbTarget;
  armR: LimbTarget;
  legL: LimbTarget;
  legR: LimbTarget;
  /** Веса режимов (сумма 1): стойка на воде, кроль, нырок. */
  mix: { tread: number; crawl: number; dive: number };
}

export interface SwimInput {
  /** Y ступней игрока. */
  y: number;
  vx: number; vy: number; vz: number;
  yaw: number; pitch: number;
  /** В воде, не на дне и не в полёте. */
  swimming: boolean;
  /** Голова под водой; если неизвестно, считаем, что над водой. */
  headInWater?: boolean;
  /** Высота поверхности воды над игроком; если неизвестна, считаем, что игрок на плаву. */
  waterSurface?: number | null;
}

/** Высота таза над ступнями: центр вращения корпуса. */
export const HIP_HEIGHT = 0.68;

const DEG = Math.PI / 180;
const PRONE_PIVOT_DEPTH = 0.05; // ось тела лёжа почти на воде: спина на поверхности, рот на вдохе над ней, кисть при выносе над водой
const ENTRY_GRACE = 0.6; // секунд после входа в воду, когда падение не считается нырком
const TREAD_LEAN = 0.1; // на месте корпус чуть откинут назад
const CRAWL_INCLINE = 0.03; // в кроле голова чуть выше таза (у хороших пловцов тело лежит под углом 3–8°)
const BREATH_TURN = 1.15; // поворот головы на вдох относительно торса
const BREATH_EXTRA_ROLL = 0.14; // на вдохе корпус доворачивается к стороне дыхания

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Угол в диапазон (−π, π]. */
export function wrapAngle(a: number): number {
  let r = (a + Math.PI) % (2 * Math.PI);
  if (r < 0) r += 2 * Math.PI;
  return r - Math.PI;
}

/**
 * Единичное направление звена. θ — отмах в плоскости «тело вперёд/грудь»: 0 — вдоль тела к ногам,
 * 90° — к груди (вперёд при стойке, вниз при плавании лёжа), 180° — к голове, 270° — к спине (вверх при плавании лёжа).
 * ψ — отведение в сторону от середины тела; side: +1 правая конечность, −1 левая.
 */
export function limbDir(thetaDeg: number, psiDeg: number, side: 1 | -1, out: Vec3 = [0, 0, 0]): Vec3 {
  const th = thetaDeg * DEG;
  const ps = psiDeg * DEG;
  out[0] = side * Math.sin(ps);
  out[1] = -Math.cos(ps) * Math.cos(th);
  out[2] = -Math.cos(ps) * Math.sin(th);
  return out;
}

/** Поворот вектора на месте вокруг оси Y на угол a (как rotation.y в three.js). */
function rotY(v: Vec3, a: number): void {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const x = v[0] * c + v[2] * s;
  v[2] = -v[0] * s + v[2] * c;
  v[0] = x;
}

/**
 * Периодический сплайн по ключевым кадрам [время 0..1, значения…] с неравномерными интервалами
 * (кубический Эрмит, касательные по Катмуллу–Рому). wind — приращение столбца за полный цикл
 * (например, −360° для плеча, которое за цикл делает полный оборот).
 */
export function loopSample(keys: readonly (readonly number[])[], phase: number, wind: readonly number[], out: number[]): number[] {
  const n = keys.length;
  const cols = keys[0].length - 1;
  const t = phase - Math.floor(phase);
  // Последний ключ со временем ≤ t; для t левее первого ключа это последний ключ предыдущего цикла.
  let found = n - 1;
  for (let k = 0; k < n; k++) if (keys[k][0] <= t) found = k;
  const before = t < keys[found][0];
  const i0 = before ? found - n : found;
  const tt = before ? t + 1 : t;
  // Ключ с индексом idx вне [0, n) берётся из соседнего цикла: время сдвигается, а столбцы получают wind.
  const time = (idx: number): number => keys[((idx % n) + n) % n][0] + Math.floor(idx / n);
  const value = (idx: number, col: number): number =>
    keys[((idx % n) + n) % n][col + 1] + Math.floor(idx / n) * (wind[col] ?? 0);
  const t0 = time(i0);
  const t1 = time(i0 + 1);
  const tm = time(i0 - 1);
  const tp = time(i0 + 2);
  const h = t1 - t0;
  const s = (tt - t0) / h;
  const s2 = s * s;
  const s3 = s2 * s;
  for (let col = 0; col < cols; col++) {
    const p0 = value(i0, col);
    const p1 = value(i0 + 1, col);
    const m0 = ((p1 - value(i0 - 1, col)) / (t1 - tm)) * h;
    const m1 = ((value(i0 + 2, col) - p0) / (tp - t0)) * h;
    out[col] = (2 * s3 - 3 * s2 + 1) * p0 + (s3 - 2 * s2 + s) * m0 + (-2 * s3 + 3 * s2) * p1 + (s3 - s2) * m1;
  }
  return out;
}

// ---------------------------------------------------------------- кроль

/**
 * Ключевые кадры гребка одной руки в системе тела без крена (вода-выровненной).
 * Колонки: фаза цикла руки (0 — вход кисти в воду), θ и ψ плеча, θ и ψ предплечья, градусы.
 * Плечо за цикл делает полный оборот (θ убывает на 360°): вперёд → вниз → назад под водой → вверх → вперёд над водой.
 */
const CRAWL_ARM_KEYS: readonly (readonly number[])[] = [
  [0.00, 165, 4, 168, 4], // вход: рука тянется вперёд и чуть вниз, пальцами вперёд
  [0.10, 160, 8, 150, 10], // скольжение вперёд, кисть начинает опускаться
  [0.24, 155, 26, 88, 16], // захват (catch): локоть высоко, предплечье вертикально, ладонь назад
  [0.38, 108, 20, 62, -28], // подтягивание под грудь: кисть идёт к середине тела
  [0.52, 58, 16, 24, 18], // выталкивание: рука к бедру почти выпрямляется
  [0.62, 22, 14, 14, 14], // выход кисти у бедра
  [0.70, -42, 50, 66, 24], // локоть идёт вверх первым, предплечье свисает
  [0.79, -100, 62, 105, 30], // высокий локоть в стороне, кисть расслаблена и над водой
  [0.89, -168, 20, 172, 6], // вынос вперёд, предплечье разгибается к входу
];
const CRAWL_ARM_WIND = [-360, 0, 0, 0];

const armScratch = [0, 0, 0, 0];

/** Поза одной руки в кроле для фазы цикла (в системе тела без крена). */
export function crawlArm(phase: number, side: 1 | -1, out: LimbTarget): LimbTarget {
  const k = loopSample(CRAWL_ARM_KEYS, phase, CRAWL_ARM_WIND, armScratch);
  limbDir(k[0], k[1], side, out.upper);
  limbDir(k[2], k[3], side, out.lower);
  return out;
}

/**
 * Флаттер: бедро качается из сустава, колено гнётся в начале удара вниз (стопа отстаёт), а к концу
 * удара голень «хлыстом» выпрямляется. phase — фаза удара в циклах, amp — размах бедра в радианах.
 */
export function flutterLeg(phase: number, side: 1 | -1, amp: number, out: LimbTarget): LimbTarget {
  const ph = phase * 2 * Math.PI;
  const thigh = 0.1 + amp * Math.sin(ph);
  const knee = 0.12 + 0.55 * (amp / 0.27) * (0.5 + 0.5 * Math.cos(ph));
  limbDir(thigh / DEG, 0, side, out.upper);
  limbDir((thigh - knee) / DEG, 0, side, out.lower);
  return out;
}

// ---------------------------------------------------------------- стойка на воде

/** Скуллинг: предплечья перед собой, кисти описывают в воде небольшие восьмёрки. */
function treadArm(phase: number, side: 1 | -1, effort: number, out: LimbTarget): LimbTarget {
  const ph = phase * 2 * Math.PI;
  const sweep = 18 + 14 * effort;
  limbDir(18, 38, side, out.upper);
  limbDir(80 + 9 * Math.cos(2 * ph), 30 + sweep * Math.sin(ph), side, out.lower);
  return out;
}

/** «Яйцебитер»: бёдра разведены вперёд, голени поочерёдно описывают круги в разные стороны. */
function treadLeg(phase: number, side: 1 | -1, effort: number, out: LimbTarget): LimbTarget {
  const ph = (side === 1 ? phase : 0.5 - phase) * 2 * Math.PI;
  const r = 0.3 + 0.12 * effort;
  limbDir(62, 32, side, out.upper);
  const x = side * 0.12 + r * Math.cos(ph);
  const z = -0.1 + r * Math.sin(ph);
  const len = Math.hypot(x, 1, z);
  out.lower[0] = x / len;
  out.lower[1] = -1 / len;
  out.lower[2] = z / len;
  return out;
}

// ---------------------------------------------------------------- нырок

function diveArm(side: 1 | -1, out: LimbTarget): LimbTarget {
  limbDir(176, -22, side, out.upper);
  limbDir(178, -24, side, out.lower);
  return out;
}

// ---------------------------------------------------------------- аниматор

const newLimb = (): LimbTarget => ({ upper: [0, -1, 0], lower: [0, -1, 0] });
const mixDir = (out: Vec3, a: Vec3, wa: number, b: Vec3, wb: number, c: Vec3, wc: number): void => {
  let x = a[0] * wa + b[0] * wb + c[0] * wc;
  let y = a[1] * wa + b[1] * wb + c[1] * wc;
  let z = a[2] * wa + b[2] * wb + c[2] * wc;
  let len = Math.hypot(x, y, z);
  if (len < 1e-3) { // противоположные направления гасят друг друга — берём самый «тяжёлый» режим
    const best = wa >= wb && wa >= wc ? a : wb >= wc ? b : c;
    x = best[0]; y = best[1]; z = best[2]; len = 1;
  }
  out[0] = x / len; out[1] = y / len; out[2] = z / len;
};

/** Состояние и расчёт позы пловца: фазы гребка и удара ног, сглаживание скоростей, веса режимов. */
export class SwimAnimator {
  private speed = 0;
  private vy = 0;
  private weight = 0;
  private lean = 0;
  private heading = 0;
  private lift = 0;
  private headOut = 1;
  private grace = 0;
  private wasSwimming = false;
  private stroke = 0; // циклы рук, по модулю 3 (рисунок дыхания повторяется каждые 6 гребков)
  private kick = 0;
  private scull = 0;
  private egg = 0;
  private time = 0;

  private readonly pose: SwimPose = {
    weight: 0, headingOffset: 0, lean: 0, hipRoll: 0, shoulderTwist: 0, lift: 0, bob: 0,
    headYaw: 0, headPitch: 0, footPlantar: 0, handsFree: false,
    armL: newLimb(), armR: newLimb(), legL: newLimb(), legR: newLimb(),
    mix: { tread: 1, crawl: 0, dive: 0 },
  };
  private readonly tmp = { tread: newLimb(), crawl: newLimb(), dive: newLimb() };

  /** Считает позу на кадр. Возвращаемый объект переиспользуется — копируйте нужное сразу. */
  update(dt: number, i: SwimInput): SwimPose {
    const k = (rate: number): number => 1 - Math.exp(-rate * dt);
    this.time += dt;

    // --- Сглаженные скорости и режим движения ---
    const sp = Math.hypot(i.vx, i.vz);
    this.speed += (sp - this.speed) * k(8);
    this.vy += (i.vy - this.vy) * k(6);
    if (i.swimming && !this.wasSwimming) this.grace = ENTRY_GRACE;
    this.wasSwimming = i.swimming;
    this.grace = Math.max(0, this.grace - dt);
    // Падение в воду — не нырок: сначала человек входит в воду «ногами» и лишь потом ложится на курс.
    const vy = this.grace > 0 ? 0 : this.vy;
    const speed = this.speed;
    const m = Math.hypot(speed, vy);
    const g = smoothstep(0.7, 1.7, m); // 0 — на месте, 1 — активно плывёт
    const alpha = Math.atan2(vy, speed); // угол траектории: <0 — вниз, >0 — вверх
    const up = smoothstep(0.5, 1.1, alpha);
    const down = smoothstep(0.55, 1.15, -alpha);
    const crawl = g * (1 - up - down);
    const dive = g * down;
    const tread = Math.max(0, 1 - crawl - dive);
    const effort = clamp(m / WATER_SWIM_SPEED, 0, 1);

    this.weight += ((i.swimming ? 1 : 0) - this.weight) * k(6);
    this.headOut += ((i.headInWater ? 0 : 1) - this.headOut) * k(8);

    // --- Корпус: ось тела вдоль траектории ---
    const beta = Math.atan2(speed, vy); // угол оси тела от «вверх»: 0 — вертикально, π/2 — горизонтально, π — вниз головой
    const leanTarget = i.swimming ? -beta * g + TREAD_LEAN * (1 - g) + CRAWL_INCLINE * crawl : 0;
    this.lean += (leanTarget - this.lean) * k(i.swimming ? 7 : 12);

    // Пловец смотрит туда, куда плывёт: боком или назад он не плывёт, а разворачивается.
    const travelYaw = Math.atan2(-i.vx, -i.vz);
    const proneW = crawl + dive;
    const headingTarget = i.swimming && sp > 0.3 ? i.yaw + wrapAngle(travelYaw - i.yaw) * proneW : i.yaw;
    this.heading += wrapAngle(headingTarget - this.heading) * k(i.swimming ? 8 : 10);

    // --- Фазы ---
    const cycleHz = 0.5 + 0.5 * effort; // циклов рук в секунду: 30…60 в минуту, как у любителя и спринтера
    this.stroke = (this.stroke + dt * cycleHz) % 3;
    // От 2 до 6 ударов на цикл рук; за кадр не больше четверти удара, чтобы на слабом телефоне не было «стробоскопа».
    this.kick = (this.kick + Math.min(dt * cycleHz * (2 + 4 * effort), 0.25)) % 1000;
    this.scull = (this.scull + dt * (1.1 + 0.6 * effort)) % 1000;
    this.egg = (this.egg + dt * (1.7 + 1.3 * effort)) % 1000;

    const out = this.pose;
    const c = this.stroke;

    // --- Крен: плечи вращаются раньше и больше бёдер, с ростом скорости крен бёдер падает ---
    const shoulderAmp = 0.9 - 0.1 * effort;
    const hipAmp = 0.66 - 0.22 * effort;
    let shoulderRoll = shoulderAmp * Math.cos(2 * Math.PI * (c - 0.08));
    let hipRoll = hipAmp * Math.cos(2 * Math.PI * (c - 0.2));

    // --- Дыхание: каждый третий гребок, поочерёдно вправо и влево; голова поворачивается, а не поднимается ---
    const entry = Math.ceil(2 * c - 1e-9); // номер ближайшего входа руки в воду: чётный — правая рука
    const t = (c - (entry / 2 - 0.47)) / 0.44;
    let breath = 0;
    if (entry % 3 === 0 && t > 0 && t < 1) breath = smoothstep(0, 0.3, t) * (1 - smoothstep(0.7, 1, t));
    breath *= this.headOut; // под водой пловец задерживает дыхание
    const side: 1 | -1 = entry % 2 === 0 ? 1 : -1;
    shoulderRoll -= side * BREATH_EXTRA_ROLL * breath;
    hipRoll -= side * BREATH_EXTRA_ROLL * breath * 0.6;

    // --- Покачивание на воде ---
    const treadSway = Math.sin(this.time * 2 * Math.PI * 0.45);
    const bobCrawl = Math.cos(4 * Math.PI * c) * 0.018;
    const bobTread = treadSway * 0.03;

    // --- Положение по высоте ---
    const betaBody = clamp(-this.lean, 0, Math.PI);
    const centerLift = 0.21 * (1 - Math.cos(betaBody)); // тело по центру физического объёма игрока
    let surface = i.waterSurface;
    if (surface == null) surface = i.y + (i.headInWater ? 2 : WATER_FLOAT_DEPTH);
    const pivotPhys = i.y + HIP_HEIGHT + centerLift;
    const distToSurface = surface - PRONE_PIVOT_DEPTH - pivotPhys;
    // Пока игрок держится на плаву, тело лежит на воде; глубже уровня плавания привязка к поверхности угасает.
    const coupling = clamp(1 - Math.abs(i.y - (surface - WATER_FLOAT_DEPTH)) / 0.7, 0, 1);
    const proneness = clamp(Math.sin(betaBody), 0, 1);
    const liftTarget = i.swimming ? centerLift + proneness * coupling * distToSurface : 0;
    this.lift += (liftTarget - this.lift) * k(10);

    // --- Итог по корпусу: крен считаем до конечностей, потому что руки и ноги задаются «вода-выровненно» ---
    const treadRoll = 0.05 * Math.sin(this.time * 2 * Math.PI * 0.3);
    const hipRollOut = crawl * hipRoll + tread * treadRoll;
    const torsoRollOut = crawl * shoulderRoll + tread * treadRoll * 1.6;

    // --- Конечности: смешиваем три режима ---
    const tmp = this.tmp;
    const blendArm = (phase: number, sd: 1 | -1, outLimb: LimbTarget): void => {
      crawlArm(phase, sd, tmp.crawl);
      rotY(tmp.crawl.upper, -torsoRollOut); // из «вода-выровненной» системы — в систему повёрнутых плеч
      rotY(tmp.crawl.lower, -torsoRollOut);
      treadArm(this.scull, sd, effort, tmp.tread);
      diveArm(sd, tmp.dive);
      mixDir(outLimb.upper, tmp.tread.upper, tread, tmp.crawl.upper, crawl, tmp.dive.upper, dive);
      mixDir(outLimb.lower, tmp.tread.lower, tread, tmp.crawl.lower, crawl, tmp.dive.lower, dive);
    };
    blendArm(c, 1, out.armR);
    blendArm(c + 0.5, -1, out.armL);

    const kickAmp = 0.23 + 0.05 * effort;
    const blendLeg = (kickPhase: number, sd: 1 | -1, outLimb: LimbTarget): void => {
      flutterLeg(kickPhase, sd, kickAmp, tmp.crawl);
      rotY(tmp.crawl.upper, -hipRollOut);
      rotY(tmp.crawl.lower, -hipRollOut);
      flutterLeg(kickPhase, sd, kickAmp * 0.7, tmp.dive);
      treadLeg(this.egg, sd, effort, tmp.tread);
      mixDir(outLimb.upper, tmp.tread.upper, tread, tmp.crawl.upper, crawl, tmp.dive.upper, dive);
      mixDir(outLimb.lower, tmp.tread.lower, tread, tmp.crawl.lower, crawl, tmp.dive.lower, dive);
    };
    blendLeg(this.kick, 1, out.legR);
    blendLeg(this.kick + 0.5, -1, out.legL);

    out.weight = this.weight;
    out.headingOffset = wrapAngle(this.heading - i.yaw);
    out.lean = this.lean;
    out.hipRoll = hipRollOut;
    out.shoulderTwist = torsoRollOut - hipRollOut;
    out.lift = this.lift;
    out.bob = crawl * bobCrawl + tread * bobTread;
    out.headYaw = -side * BREATH_TURN * breath * crawl;
    const lookPitch = clamp(i.pitch * 0.85, -0.9, 0.9);
    out.headPitch = tread * lookPitch + crawl * lerp(0.32, 0.18, 1 - this.headOut) + dive * 0.12;
    out.footPlantar = 0.85 * (crawl + dive) - 0.15 * tread;
    out.handsFree = crawl + dive > 0.5;
    out.mix.tread = tread;
    out.mix.crawl = crawl;
    out.mix.dive = dive;
    return out;
  }
}
