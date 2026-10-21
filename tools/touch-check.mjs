// Phone check, with touch emulation (touch events, a coarse pointer, DPR 2) at 390x844 (held upright), 844x300 (on its side under a
// browser's address bar) and 844x390 (on its side). At each size:
//   HUD       no touch button or HUD element overlaps another or the car, none is off screen, every button is 44 px or more
//   copy      the prompts say tap and name no key; the pause line names the Resume and Restart buttons, the game-over line Restart
//   screens   start -> an app switch pauses -> Resume -> pause -> Restart -> game over -> Restart, all with real taps; the touch
//             buttons and the HUD step aside while a screen is open and are back, and working, after it
//   wall      on the arena wall: SUCTION is lit, holding BRAKE stops the car there, letting go climbs again
//   canvas    the drawing buffer matches its box, also when only the visual viewport shrinks (keyboard up, a toolbar sliding in)
//   node tools/touch-check.mjs        (needs `npm run preview` on :4173, or BASE=http://localhost:5173/ for the dev server)
import { launch, open, sleep, state } from './lib.mjs';

const SIZES = [[390, 844], [844, 300], [844, 390]];
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };

/** Runs in the page: every HUD element and touch button must be on screen, 4 px clear of the others, and off the car; buttons >= 44 px. */
function measure() {
  const vis = (el) => !!el && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getClientRects().length > 0;
  const box = (el) => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const text = (el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); const e = el.getBoundingClientRect(); return { l: b.left, t: e.top, r: b.right, b: e.bottom }; };
  const items = [];
  const add = (name, el, shape = 'rect', how = box) => { if (vis(el)) items.push({ name, shape, ...how(el) }); };
  for (const b of document.querySelectorAll('#touch [data-t]')) add('btn:' + b.dataset.t, b, 'circle');
  document.querySelectorAll('#topbar .stat').forEach((e, i) => add('stat' + i, e));
  add('suc', document.getElementById('suc'));
  add('g-ring', document.querySelector('.ring.left .ringbox'), 'circle');
  add('g-icon', document.querySelector('.ring.left .icon'), 'circle');
  add('a-ring', document.querySelector('.ring.right .ringbox'), 'circle');
  add('a-icon', document.querySelector('.ring.right .icon'), 'circle');
  add('speed', document.getElementById('h-speed'), 'rect', text);
  add('kmh', document.querySelector('#speed .unit'), 'rect', text);
  add('gas', document.getElementById('gas'));

  // the car's screen rectangle: its visible meshes' boxes through the game camera (the page is opened with ?debug for this)
  const scene = window.__scene, cam = window.__post.composer.passes[0].camera;
  const root = scene.getObjectByName('roadster-glb') || scene.getObjectByName('roadster-procedural');
  scene.updateMatrixWorld(true); cam.updateMatrixWorld(true); cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
  const V = cam.matrixWorldInverse.elements, P = cam.projectionMatrix.elements, W = innerWidth, H = innerHeight;
  const proj = (x, y, z) => {
    const vx = V[0] * x + V[4] * y + V[8] * z + V[12], vy = V[1] * x + V[5] * y + V[9] * z + V[13], vz = V[2] * x + V[6] * y + V[10] * z + V[14];
    const cx = P[0] * vx + P[4] * vy + P[8] * vz + P[12], cy = P[1] * vx + P[5] * vy + P[9] * vz + P[13], cw = P[3] * vx + P[7] * vy + P[11] * vz + P[15];
    return [((cx / cw) * 0.5 + 0.5) * W, (1 - ((cy / cw) * 0.5 + 0.5)) * H, cw];
  };
  const car = { l: 1e9, t: 1e9, r: -1e9, b: -1e9, shape: 'rect' };
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    for (let p = o; p; p = p.parent) if (p.visible === false) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat && mat.transparent && mat.opacity < 0.3) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const bb = o.geometry.boundingBox, M = o.matrixWorld.elements;
    for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
      const [px, py, pw] = proj(M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]);
      if (pw > 0) { car.l = Math.min(car.l, px); car.r = Math.max(car.r, px); car.t = Math.min(car.t, py); car.b = Math.max(car.b, py); }
    }
  });

  const dist = (a, b) => { // gap in px between two items (negative: overlapping); circles are circles
    const c = (e) => ({ x: (e.l + e.r) / 2, y: (e.t + e.b) / 2, r: Math.min(e.r - e.l, e.b - e.t) / 2 });
    const toRect = (p, e) => Math.hypot(Math.max(e.l - p.x, 0, p.x - e.r), Math.max(e.t - p.y, 0, p.y - e.b));
    if (a.shape === 'circle' && b.shape === 'circle') return Math.hypot(c(a).x - c(b).x, c(a).y - c(b).y) - c(a).r - c(b).r;
    if (a.shape === 'circle' || b.shape === 'circle') {
      const [k, e] = a.shape === 'circle' ? [a, b] : [b, a];
      const p = c(k), inside = p.x > e.l && p.x < e.r && p.y > e.t && p.y < e.b;
      return inside ? -p.r : toRect(p, e) - p.r;
    }
    const dx = Math.max(a.l - b.r, b.l - a.r), dy = Math.max(a.t - b.b, b.t - a.b);
    return dx > 0 || dy > 0 ? Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) : Math.max(dx, dy);
  };
  const out = [];
  for (const it of items) {
    if (it.l < -0.5 || it.t < -0.5 || it.r > W + 0.5 || it.b > H + 0.5) out.push(`${it.name} off screen`);
    if (it.name.startsWith('btn:') && Math.min(it.r - it.l, it.b - it.t) < 43.5) out.push(`${it.name} under 44 px`);
    if (car.r > car.l && dist(it, car) < 0) out.push(`${it.name} over the car`);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    if (items[i].name + items[j].name === 'speedkmh') continue; // one block of text
    if (dist(items[i], items[j]) < 4) out.push(`${items[i].name} ~ ${items[j].name}`);
  }
  return { n: items.length, out };
}

for (const [w, h] of SIZES) {
  const tag = `${w}x${h}`;
  const { browser, ctx, page, logs } = await launch({ width: w, height: h, dpr: 2, touch: true });
  const cdp = await ctx.newCDPSession(page);
  const finger = (type, p) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: p.x, y: p.y }] });
  const at = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, sel);
  const tap = async (p) => page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
  const text = (id) => page.evaluate((i) => document.getElementById(i).textContent, id);
  const waitPhase = (ph) => page.waitForFunction((p) => window.__game.state.phase === p, ph, { timeout: 15000, polling: 30 });
  const away = (hidden) => page.evaluate((hd) => { // an app switch: the page is hidden, then shown again
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hd });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hd ? 'hidden' : 'visible') });
    document.dispatchEvent(new Event('visibilitychange'));
  }, hidden);
  const layers = () => page.evaluate(() => ({
    open: document.body.classList.contains('screen-open'),
    touch: getComputedStyle(document.getElementById('touch')).visibility,
    hud: getComputedStyle(document.getElementById('hud')).visibility,
  }));

  await open(page, '?lang=en&debug');
  await page.addStyleTag({ content: '#debug { display: none !important; }' });
  await sleep(900);

  // start screen
  const go = await text('s-go');
  check(`${tag} start prompt says tap and names no key`, /tap/i.test(go) && !/\b(Enter|Esc|R)\b|click/.test(go), `"${go}"`);
  let l = await layers();
  check(`${tag} the touch buttons stay away from the start screen`, l.open && l.touch === 'hidden');
  await tap({ x: w / 2, y: h / 2 });
  await waitPhase('playing');
  await sleep(900);
  l = await layers();
  check(`${tag} playing: the touch buttons and the HUD are up`, !l.open && l.touch === 'visible' && l.hud === 'visible');
  const m = await page.evaluate(measure);
  check(`${tag} HUD: ${m.n} items, no overlap, none off screen, none over the car, buttons >= 44 px`, m.out.length === 0, m.out.join('; '));

  // an app switch pauses; Resume; the buttons work again
  await away(true);
  await waitPhase('paused');
  await away(false);
  await sleep(600);
  l = await layers();
  check(`${tag} paused: the touch buttons and the HUD step aside`, l.open && l.touch === 'hidden' && l.hud === 'hidden');
  const hint = await text('p-hint');
  const [lr, ls] = [await text('p-resume'), await text('p-restart')];
  check(`${tag} the pause line names Resume and Restart and no key`, hint.includes(lr) && hint.includes(ls) && !/\b(Enter|Esc|R)\b/.test(hint), `"${hint}"`);
  await tap({ x: 30, y: h / 2 });
  await sleep(250);
  check(`${tag} a tap beside the buttons leaves it paused`, (await state(page)).phase === 'paused');
  await tap(await at('#p-resume'));
  await waitPhase('playing');
  await sleep(400);
  l = await layers();
  const suc = (await state(page)).suction;
  await tap(await at('#touch [data-t=suction]'));
  await sleep(300);
  check(`${tag} Resume: the run goes on, the buttons are back and work`, !l.open && l.touch === 'visible' && l.hud === 'visible' && (await state(page)).suction !== suc);

  // Restart from the pause card, then game over and Restart again
  await away(true);
  await waitPhase('paused');
  await away(false);
  await sleep(400);
  await tap(await at('#p-restart'));
  await waitPhase('playing');
  await sleep(400);
  let s = await state(page);
  check(`${tag} Restart (pause) starts a fresh run`, s.lives === 3 && s.score < 20 && s.z > -40, `score ${s.score}, z ${s.z.toFixed(0)}`);
  await page.evaluate(() => window.__game.debug.gameOver());
  await sleep(700);
  const over = await text('o-hint');
  const lo = await text('o-restart');
  check(`${tag} game over: the line names Restart and no key, the buttons step aside`, over.includes(lo) && !/\b(Enter|Esc|R)\b/.test(over) && (await layers()).touch === 'hidden', `"${over}"`);
  await tap(await at('#o-restart'));
  await waitPhase('playing');
  await sleep(400);
  s = await state(page);
  l = await layers();
  check(`${tag} Restart (game over) starts a fresh run, the buttons are back`, s.lives === 3 && s.score < 20 && !l.open && l.touch === 'visible', `score ${s.score}`);

  // the arena wall: suction on, hold BRAKE, let go
  await page.evaluate(() => window.__game.debug.arenaWall(6, 0, true));
  await sleep(500);
  const lit = await page.evaluate(() => document.querySelector('#touch [data-t=suction]').classList.contains('lit'));
  const brake = await at('#touch [data-t=brake]');
  await finger('touchStart', brake);
  await sleep(1200);
  const a = await state(page);
  await sleep(900);
  const b = await state(page);
  check(`${tag} wall: SUCTION is lit and holding BRAKE stops the car (s ${a.wallS.toFixed(2)} -> ${b.wallS.toFixed(2)})`, lit && a.mode === 'wall' && b.mode === 'wall' && Math.abs(b.wallS - a.wallS) < 0.15);
  await finger('touchEnd', brake);
  await sleep(400);
  check(`${tag} wall: letting go climbs again`, (await state(page)).wallS > b.wallS + 0.3);

  // the buffer matches its box when only the visual viewport changes
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 420 });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  await sleep(400);
  const c = await page.evaluate(() => { const e = document.getElementById('c'); return [e.width, e.height, e.clientWidth, e.clientHeight]; });
  check(`${tag} canvas: the buffer (${c[0]}x${c[1]}) matches its box (${c[2]}x${c[3]}) with only the visual viewport shrunk`, Math.abs(c[0] / c[1] - c[2] / c[3]) < 0.01);

  const noise = logs.filter((x) => !/toNonIndexed|AudioContext|\[car\]/.test(x));
  check(`${tag} no console errors`, noise.length === 0, noise.slice(0, 2).join(' ; '));
  await browser.close();
}
console.log(bad ? `${bad} FAILED` : 'touch check: PASS');
process.exit(bad ? 1 : 0);
