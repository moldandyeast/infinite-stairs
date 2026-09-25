// Pure functions: MediaPipe pose landmarks -> body signals -> knob values.
// No DOM, no state except the small StompDetector. Unit-tested in test/mapping.test.mjs.

// MediaPipe Pose landmark indices (person's own left/right).
export const LM = { nose: 0, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 };

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const vis = (p, min = .5) => p && (p.visibility == null || p.visibility >= min);

// Knobs the body owns. Everything else stays manual on the deck.
export const DRIVEN = ['zoom', 'chaos', 'cuts', 'dutch', 'hue', 'filter', 'shake', 'glitch', 'lines', 'kick', 'drone', 'punch'];

// Normalized body signals, all scaled by shoulder width so distance to camera doesn't matter.
// Returns null when there's no usable body in frame.
export function signals(lm) {
  if (!lm || lm.length < 33) return null;
  const lS = lm[LM.lShoulder], rS = lm[LM.rShoulder], lH = lm[LM.lHip], rH = lm[LM.rHip], nose = lm[LM.nose];
  if (!vis(lS) || !vis(rS) || !vis(lH) || !vis(rH) || !vis(nose)) return null;
  const sw = dist(lS, rS);
  if (sw < .02) return null;
  const hips = mid(lH, rH), shoulders = mid(lS, rS);
  const torso = Math.max(1e-6, hips.y - nose.y);           // hip line to nose, image units
  const hand = w => vis(w, .3) ? clamp((hips.y - w.y) / torso / 1.25, 0, 1) : 0; // 0 at hip, 1 overhead
  const leftHand = hand(lm[LM.lWrist]), rightHand = hand(lm[LM.rWrist]);
  const spread = vis(lm[LM.lWrist], .3) && vis(lm[LM.rWrist], .3) ? clamp((dist(lm[LM.lWrist], lm[LM.rWrist]) / sw - 1) / 2.2, 0, 1) : 0;
  // torso lean: angle of hip->shoulder vector from vertical, saturating at 30 degrees, negative = leaning toward image left
  const lean = clamp(Math.atan2(shoulders.x - hips.x, hips.y - shoulders.y) / (Math.PI / 6), -1, 1);
  return {
    spread, leftHand, rightHand, handsUp: (leftHand + rightHand) / 2, lean,
    x: clamp(nose.x, 0, 1),
    near: clamp((sw - .12) / .35, 0, 1),
  };
}

const ENERGY_JOINTS = [LM.lWrist, LM.rWrist, LM.lElbow, LM.rElbow, LM.nose, LM.lKnee, LM.rKnee];

// Mean joint speed in shoulder-widths per second, saturating at 3 (fast arm waving) -> 0..1.
export function motionEnergy(prev, cur, dt) {
  if (!prev || !cur || !(dt > 0)) return 0;
  const sw = dist(cur[LM.lShoulder], cur[LM.rShoulder]);
  if (!(sw > .02)) return 0;
  let sum = 0, n = 0;
  for (const i of ENERGY_JOINTS) { if (vis(cur[i], .3) && vis(prev[i], .3)) { sum += dist(prev[i], cur[i]); n++; } }
  if (!n) return 0;
  return clamp(sum / n / sw / dt / 3, 0, 1);
}

// Detects a sudden vertical hip movement (stomp, jump, squat) as a one-shot event with hold-off.
export class StompDetector {
  constructor({ threshold = 4, holdOff = .45 } = {}) { this.threshold = threshold; this.holdOff = holdOff; this.prevY = null; this.prevT = null; this.lastFire = -Infinity; }
  // hipY: image y of hip midpoint; sw: shoulder width (scale); t: seconds
  update(hipY, sw, t) {
    let fired = false;
    if (this.prevY != null && sw > .02) {
      const dt = t - this.prevT;
      if (dt > 0) {
        const v = Math.abs(hipY - this.prevY) / sw / dt;   // shoulder widths per second
        if (v > this.threshold && t - this.lastFire > this.holdOff) { this.lastFire = t; fired = true; }
      }
    }
    this.prevY = hipY; this.prevT = t;
    return fired;
  }
}

// Body signals + motion energy + punch burst (0..1, decays outside) -> target values for DRIVEN knobs.
export function mapToKnobs(s, energy, burst) {
  return {
    zoom: lerp(2.2, .6, s.spread),
    chaos: s.handsUp,
    cuts: lerp(.5, 3, s.handsUp),
    dutch: Math.abs(s.lean) * 3,
    hue: Math.round(s.x * 360),
    filter: lerp(.5, 3, s.near),
    shake: energy * 3,
    glitch: energy * 3,
    lines: lerp(.3, 3, energy),
    kick: s.leftHand * 2,
    drone: s.rightHand * 2,
    punch: lerp(1, 3, clamp(burst, 0, 1)),
  };
}

// Exponential ease toward a target: tau seconds to close ~63% of the gap.
export function ease(v, target, dt, tau) {
  if (v === target) return v;
  return v + (target - v) * (1 - Math.exp(-dt / tau));
}
