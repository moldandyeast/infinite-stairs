// Browser smoke test: node test/browser.mjs  (serves ./public, uses Chrome's fake camera)
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname } from 'node:path';

const PORT = 8787, BASE = `http://127.0.0.1:${PORT}`;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.png': 'image/png' };
const server = createServer((req, res) => {
  let p = join('public', decodeURIComponent(new URL(req.url, BASE).pathname));
  if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
  if (!existsSync(p)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' }); res.end(readFileSync(p));
});
await new Promise(r => server.listen(PORT, '127.0.0.1', r));
mkdirSync('.context', { recursive: true });
const fail = m => { console.error('FAIL', m); process.exitCode = 1; };
const ok = m => console.log('ok  ', m);

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['camera'] });
  const errors = [];
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  // classic page
  await page.goto(BASE + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const api = await page.evaluate(() => Object.keys(window.parade || {}));
  api.includes('setPar') ? ok('classic: window.parade exposed ' + api.join(',')) : fail('classic: parade api missing');
  (await page.locator('#byline a[href="/move/"]').count()) === 1 ? ok('classic: Move chip present') : fail('classic: Move chip missing');
  await page.screenshot({ path: '.context/classic.png' });

  // move page
  await page.goto(BASE + '/move', { waitUntil: 'load' });
  await page.waitForTimeout(1200);
  (await page.locator('#byline a[href="/"]').count()) === 1 ? ok('move: Classic chip present') : fail('move: Classic chip missing');
  await page.click('#go', { force: true });
  await page.waitForFunction(() => window.__move && window.__move.S.on, null, { timeout: 60000 }).then(() => ok('move: model loaded, camera open, tracking on')).catch(() => fail('move: tracking never started: ' + errors.join(' | ')));
  await page.waitForTimeout(1500);
  const live = await page.evaluate(() => document.querySelectorAll('.knob.live').length);
  live === 12 ? ok('move: 12 knobs marked live') : fail('move: live knobs = ' + live);
  const started = await page.evaluate(() => window.parade.started());
  started ? ok('move: audio started from the same tap') : fail('move: audio not started');
  const goHidden = await page.evaluate(() => document.getElementById('go').hidden);
  goHidden ? ok('move: start button hidden') : fail('move: start button still visible');

  // Inject synthetic landmarks: arms overhead and wide, standing at the left of the frame.
  await page.evaluate(() => {
    const lm = Array.from({ length: 33 }, () => ({ x: .5, y: .5, visibility: 1 }));
    lm[0] = { x: .25, y: .2, visibility: 1 };
    lm[11] = { x: .4, y: .35, visibility: 1 }; lm[12] = { x: .1, y: .35, visibility: 1 };
    lm[23] = { x: .35, y: .65, visibility: 1 }; lm[24] = { x: .15, y: .65, visibility: 1 };
    lm[15] = { x: .75, y: .05, visibility: 1 }; lm[16] = { x: -.25, y: .05, visibility: 1 };
    window.__move.S.landmarker.detectForVideo = () => ({ landmarks: [lm.map(p => ({ ...p, x: 1 - p.x }))] });
  });
  await page.waitForTimeout(1500);
  const par = await page.evaluate(() => { const P = window.parade.PAR; return { chaos: P.chaos, cuts: P.cuts, zoom: P.zoom, kick: P.kick, drone: P.drone, hue: P.hue }; });
  par.chaos > .9 && par.cuts > 2.8 ? ok(`move: hands up drove chaos=${par.chaos} cuts=${par.cuts}`) : fail('move: chaos/cuts did not follow: ' + JSON.stringify(par));
  par.zoom < .7 ? ok(`move: wide arms drove zoom=${par.zoom}`) : fail('move: zoom did not follow ' + par.zoom);
  par.kick > 1.8 && par.drone > 1.8 ? ok(`move: hands drove kick=${par.kick} drone=${par.drone}`) : fail('move: kick/drone ' + JSON.stringify(par));
  Math.abs(par.hue - 90) < 8 ? ok(`move: nose at x=.25 drove hue=${par.hue}`) : fail('move: hue ' + par.hue);
  await page.keyboard.press('k'); await page.waitForTimeout(400);
  await page.screenshot({ path: '.context/move-driven.png' });

  // Lose the body: knobs should ease back to their base values.
  await page.evaluate(() => { window.__move.S.landmarker.detectForVideo = () => ({ landmarks: [] }); });
  await page.waitForTimeout(3500);
  const back = await page.evaluate(() => ({ chaos: window.parade.PAR.chaos, zoom: window.parade.PAR.zoom }));
  back.chaos < .05 && Math.abs(back.zoom - 1) < .08 ? ok(`move: body lost, eased back chaos=${back.chaos} zoom=${back.zoom}`) : fail('move: did not ease back ' + JSON.stringify(back));

  // Toggle off restores base and frees the knobs.
  await page.keyboard.press('b'); await page.waitForTimeout(300);
  const off = await page.evaluate(() => ({ on: window.__move.S.on, live: document.querySelectorAll('.knob.live').length, tracks: !!window.__move.S.stream }));
  !off.on && off.live === 0 && !off.tracks ? ok('move: B turned body off, camera released, knobs manual') : fail('move: off state ' + JSON.stringify(off));

  errors.length ? fail('errors: ' + errors.join(' | ')) : ok('no page errors on either page');
} finally {
  await browser.close(); server.close();
}
