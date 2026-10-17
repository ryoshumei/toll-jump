// Scripted screenshots of every game state. Usage: node tools/shoot.mjs [name ...]   (no names = all)
//   names: start start-en drive hover boost exit arena wall stunt etc plaza flyover drone compare
import { launch, open, sleep, state } from './lib.mjs';
const OUT = new URL('../shots/', import.meta.url).pathname;
const only = process.argv.slice(2);
const want = (n) => only.length === 0 || only.includes(n);
const W = Number(process.env.W || 1600), H = Number(process.env.H || 900);
const { browser, page, logs } = await launch({ width: W, height: H });
const dbg = (code) => page.evaluate(`(() => { const d = window.__game.debug; ${code} })()`);
const key = { down: (k) => page.keyboard.down(k), up: (k) => page.keyboard.up(k) };
const snap = async (name) => { await page.screenshot({ path: OUT + name + '.png' }); const s = await state(page); console.log('shot', name, `z=${s.z.toFixed(0)} y=${s.y.toFixed(1)} ${s.place} ${s.mode} dir=${s.dir} flipT=${s.flipT.toFixed(2)}`); };
const waitFor = (cond, timeout = 15000) => page.waitForFunction(cond, null, { timeout, polling: 20 });
const Q = (extra = '') => `?autostart&lang=zh${extra}`;

if (want('start')) { await open(page, '?lang=zh'); await sleep(2600); await snap('01-start'); }
if (want('start-en')) { await open(page, '?lang=en'); await sleep(2600); await snap('11-start-en'); }

if (want('drive') || want('hover') || want('boost') || want('drone')) {
  await open(page, Q('&noop'));
  await key.down('KeyW');
  await waitFor(() => window.__game.state.kmh > 150, 20000);
  await sleep(300);
  if (want('drive')) await snap('02-driving');
  if (want('boost')) {
    await key.down('ShiftLeft');
    await sleep(1400);
    await snap('16-rear-boost');
    await dbg("d.camera('side')");
    await sleep(1200);
    await snap('16b-rear-boost-side');
    await dbg("d.camera('chase')");
    await key.up('ShiftLeft');
  }
  if (want('drone')) {
    await dbg("d.camera('drone')");
    await sleep(2200);
    await snap('14-drone');
    await dbg("d.camera('chase')");
  }
  await key.up('KeyW');
  if (want('hover')) {
    // like a player: hold Space to climb, then add S (the in-place hover brake) at about 7 m
    await page.evaluate(() => { window.__gas = setInterval(() => window.__game.debug.gas(1), 150); });
    await key.down('Space');
    await waitFor(() => window.__game.state.y > 6.2, 8000);
    await key.down('KeyS');
    await waitFor(() => window.__game.state.kmh < 8, 20000);
    for (let i = 0; i < 5; i++) { await dbg('d.gas(1)'); await sleep(600); }
    await snap('03-hover');
    await key.up('Space');
    await key.up('KeyS');
    await page.evaluate(() => clearInterval(window.__gas));
  }
  if (want('drive')) {
    await dbg("d.lang('en')");
    await sleep(300);
    await snap('11b-hud-en');
  }
}

if (want('exit')) {
  await open(page, Q());
  await dbg('d.teleport(d.exitZ(0) + 560); d.setSpeed(90)');
  await key.down('KeyW');
  await sleep(700);
  await snap('04a-exit-sign');
  await dbg('d.teleport(d.exitZ(0) + 90); d.setSpeed(100)');
  await sleep(900);
  await snap('04b-exit-ramp');
  await key.up('KeyW');
  await dbg('const z = d.exitZ(0); d.teleport(z + 30); d.camPose(30, 16, z + 28, 12, 1, z - 55, 62)');
  await sleep(700);
  await snap('04c-exit-ramp-overview');
}

if (want('arena') || want('wall') || want('stunt')) {
  await open(page, Q());
  await dbg('d.enterArena()');
  await sleep(500);
  if (want('arena')) {
    await dbg('d.camPose(46, 20, 44, 0, 9, -62, 52)');
    await sleep(900);
    await snap('05-arena-overview');
  }
  if (want('wall')) {
    await dbg('d.arenaWall(26, 0.3, true)');
    await dbg('d.camPose(20, 15, -44, 0, 14, -72, 52)');
    await sleep(900);
    await snap('06-wall-hold-suction-on');
  }
  if (want('stunt')) {
    await dbg('d.arenaWall(27.6, 0, true)');
    await dbg('d.camPose(21, 19, -46, 0, 19, -74, 46)');
    await sleep(500);
    await key.down('KeyW');
    await waitFor(() => window.__game.state.flipping, 8000);
    await key.up('KeyW');
    await dbg('d.freeze(true)');
    await snap('07-tip-upside-down');
    await dbg('d.freeze(false); d.camPose(26, 25, -42, 0, 24, -70, 54)');
    await waitFor(() => window.__game.state.flipT > 0.6, 5000);
    await dbg('d.freeze(true)');
    await snap('08-flip-rcs');
    await dbg('d.freeze(false)');
    await waitFor(() => !window.__game.state.flipping, 5000);
    await dbg('d.camPose(44, 28, -30, 0, 27, -60, 60)');
    await sleep(450);
    await snap('09-hover-descent');
    await dbg('d.camPose(26, 7, -24, 0, 4, -52, 56)');
    await waitFor(() => window.__game.state.grounded, 25000);
    await sleep(1700);
    await snap('10-landing-reverse');
    await sleep(2300);
    await dbg('d.camPose(26, 5, -16, 0, 2, -36, 58)');
    await sleep(200);
    await snap('10b-driving-out-reversed');
  }
}

if (want('etc')) {
  await open(page, Q());
  await dbg('d.teleport(d.plazaZ(0) + 70); d.setX(-3.35); d.setSpeed(90)');
  await key.down('KeyW');
  await waitFor(() => window.__game.state.z < window.__game.debug.plazaZ(0) + 6, 8000);
  await snap('15-etc-pass');
  await key.up('KeyW');
  // the boom lifts by itself well before the car arrives: a view from the exit side along the ETC lane, car ~16 m out
  await open(page, Q());
  await dbg('d.teleport(d.plazaZ(0) + 80); d.setX(-3.35); d.setSpeed(60)');
  await key.down('KeyW');
  await waitFor(() => window.__game.state.z < window.__game.debug.plazaZ(0) + 19, 15000);
  await dbg('d.freeze(true)'); // the lifted boom stays lifted while frozen
  await dbg('const pz = d.plazaZ(0); d.camPose(-2.6, 1.5, pz - 13, -3.5, 2.0, pz + 12, 40)');
  await sleep(250);
  console.log('boom lift', (await state(page)).etcLift.toFixed(2), '(0 = down, 1 = up)');
  await snap('15b-etc-boom-up');
  await dbg('d.freeze(false)');
  await key.up('KeyW');
}
if (want('plaza') || want('flyover')) {
  await open(page, Q());
  if (want('plaza')) {
    await dbg('d.teleport(d.plazaZ(0) + 330); d.setSpeed(95)');
    await key.down('KeyW');
    await sleep(600);
    await snap('12-plaza-approach');
    await key.up('KeyW');
  }
  if (want('flyover')) {
    await dbg('d.teleport(d.plazaZ(0) + 125); d.setSpeed(150)');
    await key.down('KeyW');
    await key.down('Space');
    await waitFor(() => window.__game.state.z < window.__game.debug.plazaZ(0) + 16, 8000);
    await snap('13-flyover');
    await key.up('Space'); await key.up('KeyW');
  }
}
if (want('compare')) {
  await page.setViewportSize({ width: 2000, height: 1000 });
  await open(page, '?compare&car=procedural');
  await sleep(2500);
  await snap('compare-studio');
}
console.log(logs.filter((l) => !/toNonIndexed|AudioContext|\[car\]/.test(l)).slice(0, 6).join('\n') || 'no console issues');
await browser.close();
