// Strange Loop Parade · Move: drive the deck with your body via MediaPipe Pose.
// Everything runs in the browser. No frames or landmarks leave the device.
import { LM, DRIVEN, signals, motionEnergy, StompDetector, mapToKnobs, ease } from './mapping.js';

const MP_VERSION = '1.0.1';
const MP_BASE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

const P = window.parade;
const $ = id => document.getElementById(id);
const go = $('go'), bodyBtn = $('bodyBtn'), pip = $('pip'), msg = $('bodyMsg'), video = $('cam');
const pctx = pip.getContext('2d');

const S = { on: false, val: null, starting: false, landmarker: null, stream: null, base: null, prevLm: null, prevT: 0, lastVideoT: -1, sig: null, energy: 0, burst: 0, lostAt: 0, seen: false, connections: [] };
const stomp = new StompDetector();

let msgT = 0;
function say(text, ms = 4000) { msg.textContent = text; msg.hidden = !text; clearTimeout(msgT); if (text && ms) msgT = setTimeout(() => { msg.hidden = true; }, ms); }

function markDriven(on) {
  for (const key of DRIVEN) { const k = P.KEL[key]; if (k) k.el.classList.toggle('live', on); }
}

async function loadModel() {
  if (S.landmarker) return S.landmarker;
  say('Loading the pose model…', 0);
  const { FilesetResolver, PoseLandmarker } = await import(`${MP_BASE}/vision_bundle.mjs`);
  const files = await FilesetResolver.forVisionTasks(`${MP_BASE}/wasm`);
  const make = delegate => PoseLandmarker.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL, delegate }, runningMode: 'VIDEO', numPoses: 1, minPoseDetectionConfidence: .5, minTrackingConfidence: .5 });
  try { S.landmarker = await make('GPU'); } catch (e) { S.landmarker = await make('CPU'); }
  S.connections = PoseLandmarker.POSE_CONNECTIONS || [];
  return S.landmarker;
}

async function openCamera() {
  if (S.stream) return S.stream;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } }, audio: false });
  video.srcObject = stream; await video.play();
  S.stream = stream;
  return stream;
}

async function start() {
  if (S.on || S.starting) return;
  S.starting = true; bodyBtn.disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('nocam');
    await Promise.all([loadModel(), openCamera()]);
    S.base = Object.fromEntries(DRIVEN.map(k => [k, P.PAR[k]]));
    S.val = { ...S.base }; // float shadow: the deck rounds to knob steps, easing must not
    S.prevLm = null; S.lastVideoT = -1; S.sig = null; S.energy = 0; S.burst = 0; S.seen = false;
    S.on = true; markDriven(true); pip.classList.add('on');
    bodyBtn.setAttribute('aria-pressed', 'true'); bodyBtn.textContent = '◉ Body on';
    say('Step back so your hips are in frame. B toggles the body, V hides the little skeleton.', 6000);
    requestAnimationFrame(tick);
  } catch (e) {
    console.warn('body start failed', e);
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    say(denied ? 'Camera refused. Knobs stay manual, the parade marches on.' : e.message === 'nocam' ? 'No camera here. Knobs stay manual.' : 'Could not load the pose model. Knobs stay manual.', 7000);
    stopStream();
  }
  S.starting = false; bodyBtn.disabled = false;
}

function stopStream() { if (S.stream) { for (const t of S.stream.getTracks()) t.stop(); S.stream = null; video.srcObject = null; } }

function stop() {
  if (!S.on) return;
  S.on = false; markDriven(false); pip.classList.remove('on');
  bodyBtn.setAttribute('aria-pressed', 'false'); bodyBtn.textContent = '◉ Body';
  stopStream();
  if (S.base) { for (const k of DRIVEN) P.setPar(k, S.base[k], true); P.save(); }
  pctx.clearRect(0, 0, pip.width, pip.height);
}

function tick(now) {
  if (!S.on) return;
  const t = now / 1000, dt = S.prevT ? Math.min(.1, t - S.prevT) : 1 / 30; S.prevT = t;
  let lm = null;
  if (video.readyState >= 2 && video.currentTime !== S.lastVideoT) {
    S.lastVideoT = video.currentTime;
    try {
      const res = S.landmarker.detectForVideo(video, now);
      const raw = res.landmarks && res.landmarks[0];
      if (raw) lm = raw.map(p => ({ x: 1 - p.x, y: p.y, visibility: p.visibility })); // mirror so screen-right is your right
    } catch (e) { console.warn(e); }
    const s = signals(lm);
    if (s) {
      const a = 1 - Math.exp(-dt / .12);
      S.sig = S.sig ? Object.fromEntries(Object.keys(s).map(k => [k, S.sig[k] + (s[k] - S.sig[k]) * a])) : s;
      S.energy += (motionEnergy(S.prevLm, lm, dt) - S.energy) * (1 - Math.exp(-dt / .2));
      const hips = (lm[LM.lHip].y + lm[LM.rHip].y) / 2, sw = Math.hypot(lm[LM.lShoulder].x - lm[LM.rShoulder].x, lm[LM.lShoulder].y - lm[LM.rShoulder].y);
      if (stomp.update(hips, sw, t)) S.burst = 1;
      S.lostAt = 0; if (!S.seen) { S.seen = true; say('Got you. Move.', 1500); }
    } else if (S.sig && !S.lostAt) S.lostAt = t;
    S.prevLm = lm;
    drawPip(lm);
  }
  S.burst = ease(S.burst, 0, dt, .25);
  const lost = S.lostAt && t - S.lostAt > .5;
  if (S.sig && !lost) {
    const target = mapToKnobs(S.sig, S.energy, S.burst);
    for (const k of DRIVEN) P.setPar(k, S.val[k] = ease(S.val[k], target[k], dt, .1), true);
  } else if (lost && S.base) {
    for (const k of DRIVEN) P.setPar(k, S.val[k] = ease(S.val[k], S.base[k], dt, .7), true);
  }
  requestAnimationFrame(tick);
}

function drawPip(lm) {
  const w = pip.width, h = pip.height;
  pctx.clearRect(0, 0, w, h);
  if (!lm) return;
  const px = p => [p.x * w, p.y * h];
  pctx.lineWidth = 2; pctx.lineCap = 'round'; pctx.strokeStyle = '#FFCB3D';
  pctx.beginPath();
  for (const c of S.connections) {
    const a = lm[c.start], b = lm[c.end]; if (!a || !b || (a.visibility ?? 1) < .4 || (b.visibility ?? 1) < .4) continue;
    if (c.start < 11 && c.start !== 0 || c.end < 11 && c.end !== 0) continue; // skip face mesh lines, keep body
    pctx.moveTo(...px(a)); pctx.lineTo(...px(b));
  }
  pctx.stroke();
  pctx.fillStyle = '#FF3D6E';
  for (const i of [LM.nose, LM.lShoulder, LM.rShoulder, LM.lElbow, LM.rElbow, LM.lWrist, LM.rWrist, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle]) {
    const p = lm[i]; if (!p || (p.visibility ?? 1) < .4) continue;
    const [x, y] = px(p); pctx.beginPath(); pctx.arc(x, y, i === LM.nose ? 4 : 2.5, 0, Math.PI * 2); pctx.fill();
  }
}

// One tap unlocks sound and the camera. parade.js already starts audio on this click.
go.addEventListener('click', () => start());
bodyBtn.addEventListener('click', () => { if (S.on) stop(); else { if (!P.started()) P.begin(); start(); } });
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  if (e.key === 'b' || e.key === 'B') bodyBtn.click();
  if (e.key === 'v' || e.key === 'V') pip.classList.toggle('hide');
});
document.addEventListener('visibilitychange', () => { if (document.hidden && S.on) stop(); });

window.__move = { S, start, stop, tick, drawPip };
