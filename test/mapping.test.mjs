import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LM, signals, motionEnergy, StompDetector, mapToKnobs, DRIVEN, ease } from '../public/move/mapping.js';

// A neutral standing figure, image coords (x right, y down), person facing camera.
function figure({ shoulderW = .3, cx = .5, wristL, wristR, hipDx = 0 } = {}) {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: .5, visibility: 1 }));
  const sy = .35, hy = .65;
  lm[LM.nose] = { x: cx, y: .2, visibility: 1 };
  lm[LM.lShoulder] = { x: cx + shoulderW / 2, y: sy, visibility: 1 };
  lm[LM.rShoulder] = { x: cx - shoulderW / 2, y: sy, visibility: 1 };
  lm[LM.lHip] = { x: cx + hipDx + .1, y: hy, visibility: 1 };
  lm[LM.rHip] = { x: cx + hipDx - .1, y: hy, visibility: 1 };
  lm[LM.lWrist] = wristL || { x: cx + .2, y: hy, visibility: 1 };
  lm[LM.rWrist] = wristR || { x: cx - .2, y: hy, visibility: 1 };
  return lm;
}

test('signals: null when no landmarks or shoulders invisible', () => {
  assert.equal(signals(null), null);
  assert.equal(signals([]), null);
  const lm = figure(); lm[LM.lShoulder].visibility = .1;
  assert.equal(signals(lm), null);
});

test('signals: arms at sides give low spread, wide arms give full spread', () => {
  const rest = signals(figure());
  assert.ok(rest.spread < .25, `rest spread ${rest.spread}`);
  const wide = signals(figure({ wristL: { x: .95, y: .35, visibility: 1 }, wristR: { x: .05, y: .35, visibility: 1 } }));
  assert.ok(wide.spread > .9, `wide spread ${wide.spread}`);
});

test('signals: hand height is 0 at hip and 1 overhead, per hand', () => {
  const down = signals(figure());
  assert.ok(down.leftHand < .05 && down.rightHand < .05);
  const leftUp = signals(figure({ wristL: { x: .7, y: .05, visibility: 1 } }));
  assert.ok(leftUp.leftHand > .9, `leftHand ${leftUp.leftHand}`);
  assert.ok(leftUp.rightHand < .05);
  assert.ok(Math.abs(leftUp.handsUp - (leftUp.leftHand + leftUp.rightHand) / 2) < 1e-9);
});

test('signals: lean is signed, 0 upright, saturates at 30 degrees', () => {
  assert.ok(Math.abs(signals(figure()).lean) < .01);
  const lm = figure({ hipDx: .3 }); // hips shifted right => torso leans left in image
  const s = signals(lm);
  assert.ok(s.lean <= -.99, `lean ${s.lean}`);
});

test('signals: x follows the nose, near follows shoulder width', () => {
  assert.ok(Math.abs(signals(figure({ cx: .2 })).x - .2) < 1e-9);
  assert.ok(signals(figure({ shoulderW: .1 })).near < .05);
  assert.ok(signals(figure({ shoulderW: .5 })).near > .95);
});

test('signals: shoulder-width scaling makes spread distance-invariant', () => {
  const far = signals(figure({ shoulderW: .15, wristL: { x: .5 + .25, y: .35, visibility: 1 }, wristR: { x: .5 - .25, y: .35, visibility: 1 } }));
  const near = signals(figure({ shoulderW: .3, wristL: { x: .5 + .5, y: .35, visibility: 1 }, wristR: { x: .5 - .5, y: .35, visibility: 1 } }));
  assert.ok(Math.abs(far.spread - near.spread) < 1e-6);
});

test('motionEnergy: still body is 0, fast arms saturate to 1', () => {
  const a = figure();
  assert.equal(motionEnergy(a, a, 1 / 30), 0);
  const b = figure({ wristL: { x: .9, y: .1, visibility: 1 }, wristR: { x: .1, y: .1, visibility: 1 } });
  assert.equal(motionEnergy(a, b, 1 / 30), 1);
  const slow = motionEnergy(a, b, 4);
  assert.ok(slow > 0 && slow < .2, `slow ${slow}`);
  assert.equal(motionEnergy(null, b, 1 / 30), 0);
});

test('StompDetector: fires once on a vertical hip spike, then holds off', () => {
  const d = new StompDetector();
  let t = 0; const step = 1 / 30;
  for (let i = 0; i < 10; i++, t += step) assert.equal(d.update(.65, .3, t), false);
  assert.equal(d.update(.72, .3, t), true); t += step;   // sudden drop of hips: a stomp
  assert.equal(d.update(.79, .3, t), false); t += step;  // still moving, but within hold-off
  for (let i = 0; i < 20; i++, t += step) d.update(.65, .3, t);
  t += 1;
  d.update(.65, .3, t); t += step;
  assert.equal(d.update(.72, .3, t), true);
});

test('mapToKnobs: covers exactly the driven set and stays inside ranges', () => {
  const ranges = { cuts: [0, 3], zoom: [.4, 3], dutch: [0, 3], punch: [0, 3], glitch: [0, 3], lines: [0, 3], shake: [0, 3], chaos: [0, 1], hue: [0, 360], filter: [.3, 3], drone: [0, 2], kick: [0, 2] };
  assert.deepEqual([...DRIVEN].sort(), Object.keys(ranges).sort());
  for (const sig of [
    { spread: 0, handsUp: 0, leftHand: 0, rightHand: 0, lean: -1, x: 0, near: 0 },
    { spread: 1, handsUp: 1, leftHand: 1, rightHand: 1, lean: 1, x: 1, near: 1 },
    { spread: .5, handsUp: .5, leftHand: .2, rightHand: .8, lean: 0, x: .5, near: .5 },
  ]) for (const energy of [0, 1]) for (const burst of [0, 1]) {
    const k = mapToKnobs(sig, energy, burst);
    assert.deepEqual(Object.keys(k).sort(), Object.keys(ranges).sort());
    for (const [key, [mn, mx]] of Object.entries(ranges)) assert.ok(k[key] >= mn && k[key] <= mx, `${key}=${k[key]}`);
  }
});

test('mapToKnobs: direction of each mapping', () => {
  const base = { spread: 0, handsUp: 0, leftHand: 0, rightHand: 0, lean: 0, x: 0, near: 0 };
  const k0 = mapToKnobs(base, 0, 0);
  assert.ok(mapToKnobs({ ...base, spread: 1 }, 0, 0).zoom < k0.zoom, 'wide arms = wider shot');
  const up = mapToKnobs({ ...base, handsUp: 1 }, 0, 0);
  assert.ok(up.chaos > k0.chaos && up.cuts > k0.cuts, 'hands up = chaos + cuts');
  assert.ok(mapToKnobs({ ...base, lean: -1 }, 0, 0).dutch > k0.dutch && mapToKnobs({ ...base, lean: 1 }, 0, 0).dutch > k0.dutch, 'lean either way = dutch');
  assert.equal(mapToKnobs({ ...base, x: 1 }, 0, 0).hue, 360);
  assert.ok(mapToKnobs({ ...base, near: 1 }, 0, 0).filter > k0.filter, 'closer = brighter filter');
  const e = mapToKnobs(base, 1, 0);
  assert.ok(e.shake > k0.shake && e.glitch > k0.glitch && e.lines > k0.lines, 'energy = shake/glitch/lines');
  assert.ok(mapToKnobs({ ...base, leftHand: 1 }, 0, 0).kick > k0.kick, 'left hand = kick');
  assert.ok(mapToKnobs({ ...base, rightHand: 1 }, 0, 0).drone > k0.drone, 'right hand = drone');
  assert.ok(mapToKnobs(base, 0, 1).punch > k0.punch, 'stomp = punch');
});

test('ease: moves toward target and lands within a few time constants', () => {
  let v = 0;
  v = ease(v, 1, .1, .5); assert.ok(v > 0 && v < 1);
  for (let i = 0; i < 100; i++) v = ease(v, 1, .1, .5);
  assert.ok(Math.abs(v - 1) < 1e-3);
  assert.equal(ease(3, 3, .1, .5), 3);
});
