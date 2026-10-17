// A restart (R key, or the restart button) must equal a fresh start, even with the throttle and boost keys still held.
// Needs `npm run preview` on :4173 (or BASE=...). Exits 1 on any mismatch.
import { launch, open, sleep, state } from './lib.mjs';
const { browser, page } = await launch({ width: 1000, height: 560 });
const d = (code) => page.evaluate(`(() => { const d = window.__game.debug; ${code} })()`);
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} ${extra}`); };

await open(page, '?autostart&lang=en');
await sleep(300);
const fresh = await state(page);
console.log(`fresh start: ${fresh.kmh.toFixed(0)} km/h fov ${fresh.camFov.toFixed(1)} camDz ${fresh.camDz.toFixed(1)}`);

// like a player: hold W and Shift, boost, suction on, thrust in the air, shake the camera
const dirty = async () => {
  await page.keyboard.down('KeyW'); await page.keyboard.down('ShiftLeft');
  await d('d.suction(true)');
  await sleep(4500);
  await d('d.setAltitude(14); d.thrust(true)');
  await sleep(700);
  const s = await state(page);
  check('the run really got fast before the restart', s.kmh > 200, `(${s.kmh.toFixed(0)} km/h, fov ${s.camFov.toFixed(0)})`);
};
const same = async (label) => {
  await sleep(250);
  const s = await state(page);
  check(`${label}: back to a rolling start`, s.kmh > 25 && s.kmh < 45 && Math.abs(s.z) < 6, `(${s.kmh.toFixed(0)} km/h, z ${s.z.toFixed(1)})`);
  check(`${label}: vehicle and run reset`, s.mode === 'free' && s.grounded && s.dir === 1 && s.heading === 0 && !s.flipping && s.place === 'highway' && s.phase === 'playing'
    && s.lives === 3 && s.score < 10 && s.saved === 0 && s.gas === 1 && s.boost === 0 && s.thrust === 0 && !s.suction && s.wallS === 0 && s.stunts === 0 && s.fines === 0,
  JSON.stringify({ mode: s.mode, y: +s.y.toFixed(1), place: s.place, lives: s.lives, score: s.score, gas: s.gas, boost: s.boost, suction: s.suction }));
  check(`${label}: camera back to the start view`, Math.abs(s.camFov - fresh.camFov) < 1.5 && Math.abs(s.camDz - fresh.camDz) < 1.5 && s.trauma < 0.05,
    `(fov ${s.camFov.toFixed(1)} vs ${fresh.camFov.toFixed(1)}, camDz ${s.camDz.toFixed(1)} vs ${fresh.camDz.toFixed(1)}, trauma ${s.trauma.toFixed(2)})`);
  check(`${label}: smoke and plumes cleared`, s.particles < 12, `(${s.particles} particles)`);
  return s;
};

// 1. R with W + Shift still held: the throttle must not carry over
await dirty();
await page.keyboard.press('KeyR');
await same('R, keys held');
await sleep(1200);
let s = await state(page);
check('R, keys held: the old throttle is not driving the new run', s.kmh < 40, `(${s.kmh.toFixed(0)} km/h after 1.5 s)`);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await page.keyboard.down('KeyW'); await sleep(1500);
s = await state(page);
check('pressing W again drives the new run', s.kmh > 60, `(${s.kmh.toFixed(0)} km/h)`);
await page.keyboard.up('KeyW');

// 2. the pause screen's restart button
await dirty();
await d('d.pause()');
await sleep(300);
await page.keyboard.up('KeyW'); await page.keyboard.up('ShiftLeft');
await page.evaluate(() => { const b = [...document.querySelectorAll('button')].find((x) => /restart|重新/i.test(x.textContent) && x.offsetParent); if (b) b.click(); else throw new Error('no restart button'); });
await same('pause restart button');

// 3. restarting from the stunt arena, on the wall, with suction on
await d('d.arenaWall(40, 1.5, true)');
await sleep(400);
s = await state(page);
check('on the arena wall before the restart', s.place === 'arena' && s.mode === 'wall', JSON.stringify({ place: s.place, mode: s.mode }));
await page.keyboard.press('KeyR');
await same('R from the arena wall');

await browser.close();
console.log(bad ? `\n${bad} check(s) FAILED` : '\nrestart == fresh start: PASS');
process.exit(bad ? 1 : 0);
