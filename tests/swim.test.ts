import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Vector3 } from 'three';
import { WATER_FLOAT_DEPTH } from '../src/config.ts';
import { aimLimb } from '../src/render/PlayerModel.ts';
import {
  HIP_HEIGHT, SwimAnimator, crawlArm, flutterLeg, limbDir, wrapAngle,
  type LimbTarget, type SwimInput, type SwimPose, type Vec3,
} from '../src/render/SwimPose.ts';

const SURFACE = 46.875;
const FLOAT_Y = SURFACE - WATER_FLOAT_DEPTH;
const DT = 1 / 60;

const input = (over: Partial<SwimInput> = {}): SwimInput => ({
  y: FLOAT_Y, vx: 0, vy: 0.25, vz: -3, yaw: 0, pitch: 0, swimming: true,
  headInWater: false, waterSurface: SURFACE, ...over,
});

/** Прогоняет аниматор, пропускает settle секунд и возвращает копии поз за seconds секунд. */
function record(over: Partial<SwimInput>, seconds: number, settle = 2): SwimPose[] {
  const animator = new SwimAnimator();
  for (let i = 0; i < settle / DT; i++) animator.update(DT, input(over));
  const frames: SwimPose[] = [];
  for (let i = 0; i < seconds / DT; i++) frames.push(structuredClone(animator.update(DT, input(over))));
  return frames;
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const angle = (a: Vec3, b: Vec3): number => Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
const length = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);
const deg = (rad: number): number => (rad * 180) / Math.PI;

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  return sab / Math.sqrt(saa * sbb);
}

const limbs = (p: SwimPose): LimbTarget[] => [p.armL, p.armR, p.legL, p.legR];

// ---------------------------------------------------------------- математика суставов

test('aimLimb: рука и нога получают ровно те направления звеньев, которые заданы', () => {
  // Детерминированный набор пар направлений «плечо — предплечье» (угол сгиба до 150°).
  let seed = 12345;
  const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const randomDir = (): Vec3 => {
    const v = new Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize();
    return [v.x, v.y, v.z];
  };
  const q = new Quaternion();
  const down = new Vector3(0, -1, 0);
  let checked = 0;
  for (let n = 0; n < 400; n++) {
    const upper = randomDir();
    const lower = randomDir();
    if (angle(upper, lower) > Math.PI * 0.83) continue;
    for (const bendSign of [-1, 1] as const) {
      const flex = aimLimb(upper, lower, bendSign, q);
      // Локоть гнётся предплечьем к −Z звена (bendSign = −1, elbow.rotation.x = +сгиб),
      // колено — к +Z (bendSign = +1, knee.rotation.x = −сгиб): голень в системе бедра — (0, −cos, bendSign·sin).
      const bent = new Vector3(0, -Math.cos(flex), bendSign * Math.sin(flex)).applyQuaternion(q);
      const first = down.clone().applyQuaternion(q);
      assert.ok(first.distanceTo(new Vector3(...upper)) < 1e-6, 'плечо смотрит вдоль заданного направления');
      assert.ok(bent.distanceTo(new Vector3(...lower)) < 1e-6, 'предплечье смотрит вдоль заданного направления');
      assert.ok(Math.abs(flex - angle(upper, lower)) < 1e-6, 'сгиб равен углу между звеньями');
    }
    checked++;
  }
  assert.ok(checked > 200, `проверено пар: ${checked}`);

  // Прямая конечность: сгиба нет, предплечье продолжает плечо.
  const flex = aimLimb([0, -1, 0], [0, -1, 0], -1, q);
  assert.ok(flex < 1e-6);
});

test('гребок кролем: сплайн замкнут по циклу и не дёргается', () => {
  const a = crawlArm(0, 1, { upper: [0, 0, 0], lower: [0, 0, 0] });
  const b = crawlArm(1, 1, { upper: [0, 0, 0], lower: [0, 0, 0] });
  assert.ok(angle(a.upper, b.upper) < 1e-6 && angle(a.lower, b.lower) < 1e-6, 'конец цикла совпадает с началом');

  const prev: LimbTarget = { upper: [0, 0, 0], lower: [0, 0, 0] };
  const cur: LimbTarget = { upper: [0, 0, 0], lower: [0, 0, 0] };
  crawlArm(-0.01, 1, prev);
  let maxStep = 0;
  for (let i = 0; i <= 1100; i++) {
    crawlArm(-0.01 + i / 1000, 1, cur);
    maxStep = Math.max(maxStep, angle(prev.upper, cur.upper), angle(prev.lower, cur.lower));
    prev.upper = [...cur.upper];
    prev.lower = [...cur.lower];
  }
  assert.ok(maxStep < 0.05, `за 1/1000 цикла рука не должна поворачиваться резко: ${maxStep}`);
});

test('гребок кролем повторяет фазы настоящего гребка: высокий локоть, вертикальное предплечье, вынос над водой', () => {
  const at = (phase: number): LimbTarget => crawlArm(phase, 1, { upper: [0, 0, 0], lower: [0, 0, 0] });
  const flex = (t: LimbTarget): number => deg(angle(t.upper, t.lower));
  // В системе тела без крена: +Z — вверх к поверхности, −Z — вниз ко дну, +Y — вперёд.
  const entry = at(0);
  assert.ok(entry.upper[1] > 0.9 && flex(entry) < 15, 'вход: рука тянется вперёд почти прямой');
  assert.ok(entry.lower[2] <= 0, 'кисть входит в воду пальцами вперёд-вниз');

  const catchPose = at(0.24);
  assert.ok(catchPose.lower[2] < -0.9, `захват: предплечье вертикально, ладонь назад (z=${catchPose.lower[2]})`);
  assert.ok(flex(catchPose) > 50 && flex(catchPose) < 95, `захват: локоть согнут (внутренний угол 90–120°), сгиб ${flex(catchPose)}°`);
  assert.ok(catchPose.upper[1] > 0.6, 'захват: плечо ещё направлено вперёд — локоть высоко');

  const pull = at(0.38);
  assert.ok(pull.upper[2] < -0.7, 'подтягивание: рука под грудью');
  assert.ok(pull.lower[1] < 0, 'подтягивание: кисть уходит назад');

  const release = at(0.62);
  assert.ok(release.upper[1] < -0.8 && flex(release) < 20, 'выход: почти прямая рука у бедра');

  const recovery = at(0.79);
  assert.ok(recovery.upper[2] > 0.3, `вынос: локоть выше плеча (z=${recovery.upper[2]})`);
  assert.ok(Math.abs(recovery.upper[0]) > 0.7, 'вынос: локоть отведён в сторону');
  assert.ok(recovery.lower[2] < -0.6, 'вынос: предплечье расслабленно свисает вниз');
  assert.ok(flex(recovery) > 60 && flex(recovery) < 100, `вынос: локоть согнут около 90°, сгиб ${flex(recovery)}°`);
});

test('флаттер: колено гнётся умеренно и начинает сгибаться в ударе вниз', () => {
  const t: LimbTarget = { upper: [0, 0, 0], lower: [0, 0, 0] };
  let min = Infinity, max = 0, atMax = 0;
  for (let i = 0; i < 100; i++) {
    flutterLeg(i / 100, 1, 0.25, t);
    const flex = deg(angle(t.upper, t.lower));
    if (flex > max) { max = flex; atMax = i / 100; }
    min = Math.min(min, flex);
  }
  assert.ok(max > 20 && max < 50, `колено гнётся до ${max}° (в кроле — 20–45°)`);
  assert.ok(min < 10, `в конце удара голень почти выпрямляется (${min}°)`);
  // Сгиб максимален посередине удара вниз: бедро проходит среднее положение, двигаясь вниз.
  assert.ok(Math.abs(atMax) < 0.06 || Math.abs(atMax - 1) < 0.06, `пик сгиба в фазе ${atMax}`);
  flutterLeg(0, 1, 0.25, t);
  const mid = t.upper[2];
  flutterLeg(0.1, 1, 0.25, t);
  assert.ok(t.upper[2] < mid, 'после среднего положения бедро идёт вниз к груди (−Z)');
});

// ---------------------------------------------------------------- кроль

test('кроль: тело лежит горизонтально на воде, спина у поверхности', () => {
  const [frame] = record({}, 0.1);
  assert.ok(frame.mix.crawl > 0.95, `режим — кроль: ${JSON.stringify(frame.mix)}`);
  assert.ok(Math.abs(frame.lean + Math.PI / 2) < 0.2, `корпус почти горизонтален: наклон ${deg(frame.lean)}°`);
  assert.ok(frame.weight > 0.99, 'поза пловца полностью включена');
  // Ось тела (таз) — на пару сантиметров ниже уровня воды: спина торчит из воды, рот на вдохе выходит наружу.
  const pivot = FLOAT_Y + HIP_HEIGHT + frame.lift;
  assert.ok(Math.abs(pivot - (SURFACE - 0.05)) < 0.04, `ось тела на ${(SURFACE - pivot).toFixed(2)} ниже воды`);
  assert.ok(Math.abs(frame.headingOffset) < 0.05, 'плывёт по взгляду — разворачиваться не нужно');
});

test('кроль: руки работают по очереди, сдвинуты на полцикла (одна гребёт, другая выносится)', () => {
  const frames = record({}, 4);
  const upR = frames.map((f) => f.armR.upper[2]);
  const upL = frames.map((f) => f.armL.upper[2]);
  assert.ok(correlation(upR, upL) < -0.5, `руки движутся в противофазе (корреляция ${correlation(upR, upL).toFixed(2)})`);
  // Ни в какой момент обе руки не выносятся над водой одновременно: когда локоть одной высоко, другая под водой.
  let bothHigh = 0;
  for (let i = 0; i < frames.length; i++) if (upR[i] > 0.25 && upL[i] > 0.25) bothHigh++;
  assert.ok(bothHigh < frames.length * 0.05, `обе руки наверху одновременно в ${bothHigh} кадрах из ${frames.length}`);
  assert.ok(Math.max(...upR) > 0.3 && Math.max(...upL) > 0.3, 'каждая рука выносится высоким локтем');
});

test('кроль: ноги бьют в противофазе, 6 ударов на цикл рук, колено гнётся умеренно', () => {
  const frames = record({}, 4);
  const zR = frames.map((f) => f.legR.upper[2]);
  const zL = frames.map((f) => f.legL.upper[2]);
  assert.ok(correlation(zR, zL) < -0.95, `ноги бьют в противофазе: ${correlation(zR, zL).toFixed(2)}`);
  let kicks = 0;
  for (let i = 1; i < zR.length - 1; i++) if (zR[i] < zR[i - 1] && zR[i] <= zR[i + 1]) kicks++;
  const perCycle = kicks / 4; // при полном усилии рука делает цикл примерно за секунду
  assert.ok(perCycle > 5 && perCycle < 7, `ударов правой ноги на цикл рук: ${perCycle}`);
  for (const f of frames) {
    for (const leg of [f.legL, f.legR]) {
      assert.ok(deg(angle(leg.upper, leg.lower)) < 50, 'колено в кроле почти не гнётся');
    }
  }
  assert.ok(frames.every((f) => f.footPlantar > 0.7), 'стопы вытянуты вдоль голени');
});

test('кроль: тело вращается на 35–55° вокруг позвоночника, плечи вращаются больше бёдер и раньше них', () => {
  const frames = record({ headInWater: true }, 3); // под водой дыхания нет — крен чистый
  const hip = frames.map((f) => f.hipRoll);
  const shoulder = frames.map((f) => f.hipRoll + f.shoulderTwist);
  const maxShoulder = Math.max(...shoulder.map(Math.abs));
  const maxHip = Math.max(...hip.map(Math.abs));
  assert.ok(deg(maxShoulder) > 35 && deg(maxShoulder) < 55, `крен плеч ${deg(maxShoulder).toFixed(0)}°`);
  assert.ok(maxHip < maxShoulder * 0.8, `бёдра вращаются меньше плеч: ${deg(maxHip).toFixed(0)}° против ${deg(maxShoulder).toFixed(0)}°`);
  // Пик крена плеч наступает раньше пика крена бёдер (в пределах цикла).
  const peak = (series: number[]): number => series.indexOf(Math.max(...series.slice(0, 60)));
  const lag = peak(hip) - peak(shoulder);
  assert.ok(lag > 0 && lag < 20, `бёдра запаздывают за плечами на ${lag} кадров`);
  // Крен чередуется на обе стороны.
  assert.ok(Math.min(...shoulder) < -0.5 && Math.max(...shoulder) > 0.5);
});

test('кроль: на вдох голова поворачивается (а не поднимается), каждый третий гребок, поочерёдно в обе стороны', () => {
  const frames = record({}, 7);
  const yaw = frames.map((f) => f.headYaw);
  let breaths = 0;
  const sides: number[] = [];
  let prev = 0;
  for (const y of yaw) {
    if (Math.abs(prev) < 0.3 && Math.abs(y) >= 0.3) { breaths++; sides.push(Math.sign(y)); }
    prev = y;
  }
  // Цикл рук ≈ 1 с → 14 гребков за 7 с → вдох на каждый третий гребок: 4–5 вдохов.
  assert.ok(breaths >= 4 && breaths <= 5, `вдохов за 7 секунд: ${breaths}`);
  for (let i = 1; i < sides.length; i++) assert.notEqual(sides[i], sides[i - 1], 'вдохи чередуют стороны (двустороннее дыхание)');
  const maxTurn = Math.max(...yaw.map(Math.abs));
  assert.ok(maxTurn > 0.9 && maxTurn < 1.4, `поворот головы на вдох ${deg(maxTurn).toFixed(0)}° относительно торса`);
  // Между вдохами лицо опущено в воду, голова не крутится.
  const quiet = yaw.filter((y) => Math.abs(y) < 0.05).length;
  assert.ok(quiet > yaw.length * 0.4, 'большую часть цикла лицо в воде');
});

test('под водой пловец не дышит: голова не поворачивается на вдох', () => {
  const frames = record({ headInWater: true }, 5);
  assert.ok(frames.every((f) => Math.abs(f.headYaw) < 0.02), 'лицо остаётся в воде');
});

test('кроль ускоряется вместе со скоростью: чем быстрее плывёт, тем чаще гребки и удары', () => {
  const count = (vz: number): number => {
    const frames = record({ vz }, 4);
    let n = 0;
    const z = frames.map((f) => f.armR.upper[2]);
    for (let i = 1; i < z.length - 1; i++) if (z[i] > z[i - 1] && z[i] >= z[i + 1] && z[i] > 0.2) n++;
    return n;
  };
  const slow = count(-1.8);
  const fast = count(-3);
  assert.ok(fast > slow, `быстрее — чаще: ${slow} гребков медленно, ${fast} быстро за 4 с`);
});

// ---------------------------------------------------------------- стойка на воде и режимы

test('на месте человек стоит на воде: вертикально, руки скуллируют, ноги работают «яйцебитером»', () => {
  const frames = record({ vx: 0, vz: 0, vy: 0 }, 3);
  const f = frames[0];
  assert.ok(f.mix.tread > 0.99, 'режим — стойка на воде');
  assert.ok(Math.abs(f.lean) < 0.2, `корпус вертикален (чуть откинут назад): ${f.lean}`);
  assert.ok(f.lean > 0, 'на месте корпус немного откинут назад');
  assert.ok(Math.abs(f.lift) < 1e-6, 'модель стоит там же, где игрок: вода у шеи');
  // Бёдра разведены вперёд (сидя «в кресле»), голени свисают вниз.
  for (const [leg, side] of [[f.legL, -1], [f.legR, 1]] as const) {
    assert.ok(leg.upper[2] < -0.5, 'бедро идёт вперёд');
    assert.ok(leg.upper[0] * side > 0.3, 'колени разведены в стороны');
    assert.ok(leg.lower[1] < -0.8, 'голень свисает вниз');
    assert.ok(deg(angle(leg.upper, leg.lower)) > 55, 'колено согнуто');
  }
  // Яйцебитер: голени описывают круги — направление голени заметно меняется, а ноги идут в противоположные стороны.
  const swing = (series: number[]): number => Math.max(...series) - Math.min(...series);
  assert.ok(swing(frames.map((x) => x.legR.lower[0])) > 0.35, 'голень правой ноги описывает круг');
  const cross = (leg: 'legL' | 'legR'): number => {
    // знак вращения: векторное произведение последовательных направлений голени в плоскости XZ
    let s = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1][leg].lower, b = frames[i][leg].lower;
      s += a[0] * b[2] - a[2] * b[0];
    }
    return s;
  };
  assert.ok(cross('legL') * cross('legR') < 0, 'ноги вращаются в противоположные стороны');
  // Скуллинг: предплечья перед собой, кисти качаются в стороны.
  assert.ok(swing(frames.map((x) => x.armR.lower[0])) > 0.25, 'кисти скуллируют: водят из стороны в сторону');
  assert.ok(frames.every((x) => x.armR.lower[2] < -0.5), 'предплечья держатся перед телом');
  assert.ok(!f.handsFree, 'в стойке на воде руки можно занять блоком');
});

test('нырок: тело вытягивается вдоль траектории, руки сомкнуты над головой, вертикально — вниз головой', () => {
  const vertical = record({ vx: 0, vz: 0, vy: -2.6, y: SURFACE - 3, headInWater: true }, 0.2);
  const v = vertical[0];
  assert.ok(v.mix.dive > 0.95, 'режим — нырок');
  assert.ok(v.lean < -3, `вертикальный нырок — вниз головой: ${deg(v.lean).toFixed(0)}°`);
  for (const [arm, side] of [[v.armL, -1], [v.armR, 1]] as const) {
    assert.ok(arm.upper[1] > 0.85, 'руки вытянуты к голове («стрела»)');
    assert.ok(arm.upper[0] * side < 0, 'ладони сходятся: руки наклонены друг к другу');
    assert.ok(deg(angle(arm.upper, arm.lower)) < 10, 'локти выпрямлены');
  }
  assert.ok(v.handsFree, 'руки заняты — блок из руки убирается');

  const diagonal = record({ vx: 0, vz: -3, vy: -3, y: SURFACE - 3, headInWater: true }, 0.2)[0];
  assert.ok(diagonal.lean < -1.9 && diagonal.lean > -2.9, `диагональный нырок: ${deg(diagonal.lean).toFixed(0)}° от вертикали`);
  assert.ok(diagonal.mix.dive > 0.3 && diagonal.mix.crawl > 0.3, 'смесь нырка и кроля');
});

test('всплытие без усилий: корпус вертикален, как в стойке на воде', () => {
  const [f] = record({ vx: 0, vz: 0, vy: 1.6, y: SURFACE - 3, headInWater: true }, 0.2);
  assert.ok(f.mix.tread > 0.95, 'режим — стойка');
  assert.ok(Math.abs(f.lean) < 0.25, `всплывает вертикально: ${deg(f.lean).toFixed(0)}°`);
});

test('плывя вверх по диагонали, пловец задирает голову по ходу движения', () => {
  const [f] = record({ vx: 0, vz: -3, vy: 3, y: SURFACE - 3, headInWater: true }, 0.2);
  assert.ok(f.lean > -1.1 && f.lean < -0.4, `голова вверх: ${deg(f.lean).toFixed(0)}°`);
});

test('падение в воду — не нырок: сначала человек входит «ногами» и остаётся вертикальным', () => {
  const animator = new SwimAnimator();
  // Сухопутный прыжок, затем падение в воду на скорости 4 блока/с.
  for (let i = 0; i < 30; i++) animator.update(DT, input({ swimming: false, vz: 0, vy: -8, y: SURFACE + 3 }));
  let lean = 0;
  for (let i = 0; i < 0.5 / DT; i++) lean = Math.min(lean, animator.update(DT, input({ vz: 0, vy: -4, y: SURFACE - 1, headInWater: true })).lean);
  assert.ok(lean > -0.4, `при падении в воду корпус не переворачивается: ${deg(lean).toFixed(0)}°`);
});

test('пловец смотрит туда, куда плывёт: боком и назад он разворачивается, а на месте смотрит по взгляду', () => {
  const left = record({ vx: -3, vz: 0 }, 0.1)[0]; // yaw=0 — взгляд вдоль −Z; плывём в −X (влево)
  assert.ok(Math.abs(left.headingOffset - Math.PI / 2) < 0.05, `влево: ${deg(left.headingOffset).toFixed(0)}°`);
  const right = record({ vx: 3, vz: 0 }, 0.1)[0];
  assert.ok(Math.abs(right.headingOffset + Math.PI / 2) < 0.05, `вправо: ${deg(right.headingOffset).toFixed(0)}°`);
  const back = record({ vx: 0, vz: 3 }, 0.1)[0];
  assert.ok(Math.abs(Math.abs(back.headingOffset) - Math.PI) < 0.05, `назад: ${deg(back.headingOffset).toFixed(0)}°`);
  const still = record({ vx: 0, vz: 0, vy: 0 }, 0.1)[0];
  assert.ok(Math.abs(still.headingOffset) < 0.01, 'на месте пловец смотрит по взгляду');
  assert.ok(Math.abs(wrapAngle(3 * Math.PI) - Math.PI) < 1e-9 || Math.abs(wrapAngle(3 * Math.PI) + Math.PI) < 1e-9);
});

test('глубже уровня плавания тело не липнет к поверхности, а остаётся по центру игрока', () => {
  const deep = record({ y: SURFACE - 4, headInWater: true }, 0.2)[0];
  assert.ok(deep.lift > 0.1 && deep.lift < 0.25, `под водой тело по центру физического объёма: lift=${deep.lift}`);
  const surface = record({}, 0.2)[0];
  assert.ok(surface.lift > deep.lift + 0.2, 'у поверхности пловец ложится на воду заметно выше');
});

test('поза пловца плавно включается при входе в воду и выключается при выходе', () => {
  const animator = new SwimAnimator();
  const weights: number[] = [];
  for (let i = 0; i < 120; i++) animator.update(DT, input({ swimming: false }));
  for (let i = 0; i < 60; i++) weights.push(animator.update(DT, input()).weight);
  for (let i = 1; i < weights.length; i++) assert.ok(weights[i] >= weights[i - 1], 'вес растёт без скачков');
  assert.ok(weights[0] < 0.2 && weights[weights.length - 1] > 0.95, 'за секунду вес выходит на единицу');
  const out: number[] = [];
  for (let i = 0; i < 90; i++) out.push(animator.update(DT, input({ swimming: false, vz: 0, vy: 0 })).weight);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] <= out[i - 1], 'вес падает без скачков');
  assert.ok(out[out.length - 1] < 0.05, 'после выхода из воды поза пловца исчезает');
});

test('без сведений о воде (простая поза) пловец считается плывущим на плаву', () => {
  const animator = new SwimAnimator();
  let pose = animator.update(DT, { y: 41, vx: 0, vy: 0, vz: -3, yaw: 0, pitch: 0, swimming: true });
  for (let i = 0; i < 120; i++) pose = animator.update(DT, { y: 41, vx: 0, vy: 0, vz: -3, yaw: 0, pitch: 0, swimming: true });
  assert.ok(pose.mix.crawl > 0.95 && pose.lift > 0.4, 'тело лежит на воде, как и при известной поверхности');
});

test('все числа конечны, а направления звеньев единичные при любых скоростях, взглядах и режимах', () => {
  let seed = 987654321;
  const rnd = (): number => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const animator = new SwimAnimator();
  for (let i = 0; i < 6000; i++) {
    if (i % 90 === 0) seed = (seed + i) % 4294967296; // новые случайные «намерения»
    const swimming = rnd() > 0.15;
    const pose = animator.update(rnd() * 0.06, {
      y: SURFACE - rnd() * 5, vx: (rnd() - 0.5) * 8, vy: (rnd() - 0.5) * 9, vz: (rnd() - 0.5) * 8,
      yaw: (rnd() - 0.5) * 20, pitch: (rnd() - 0.5) * 3, swimming,
      headInWater: rnd() > 0.5, waterSurface: rnd() > 0.2 ? SURFACE : null,
    });
    for (const [key, value] of Object.entries(pose)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} = ${value}`);
    }
    for (const limb of limbs(pose)) {
      assert.ok(Math.abs(length(limb.upper) - 1) < 1e-6 && Math.abs(length(limb.lower) - 1) < 1e-6, 'единичные направления');
    }
    assert.ok(pose.weight >= 0 && pose.weight <= 1.0000001);
    const m = pose.mix;
    assert.ok(Math.abs(m.tread + m.crawl + m.dive - 1) < 1e-9 && m.tread >= 0 && m.crawl >= 0 && m.dive >= 0, 'веса режимов');
    assert.ok(Math.abs(pose.headingOffset) <= Math.PI + 1e-9);
  }
});

test('limbDir: углы задают направление звена в системе тела', () => {
  const hang = limbDir(0, 0, 1);
  assert.ok(Math.abs(hang[1] + 1) < 1e-12, 'θ=0, ψ=0 — вдоль тела к ногам');
  const forward = limbDir(90, 0, 1);
  assert.ok(forward[2] < -0.999, 'θ=90° — к груди (−Z)');
  const head = limbDir(180, 0, 1);
  assert.ok(head[1] > 0.999, 'θ=180° — к голове');
  const right = limbDir(0, 90, 1);
  const left = limbDir(0, 90, -1);
  assert.ok(right[0] > 0.999 && left[0] < -0.999, 'ψ=90° — в сторону, зеркально для левой стороны');
});
