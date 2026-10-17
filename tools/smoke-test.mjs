// End-to-end check through real key events: drive, Space thrust (+smoke), an ETC pass on the ground, the plaza flyover,
// the L key, and the whole arena stunt (up the wall, off the tip, flip, turn around, land) and back to the highway.
//   node tools/smoke-test.mjs        (needs `npm run preview` on :4173, or BASE=http://localhost:5173/ for the dev server)
import { launch, open, sleep, state } from './lib.mjs';
const { browser, page, logs } = await launch({ width: 1280, height: 720 });
const out = {};
const wait = (cond, t = 30000) => page.waitForFunction(cond, null, { timeout: t, polling: 30 });
const dbg = (code) => page.evaluate(`(() => { const d = window.__game.debug; ${code} })()`);
await open(page, '?autostart&lang=en');
await page.keyboard.down('KeyW');
await sleep(3500);
out.drive = await state(page);
await page.keyboard.down('Space');
await sleep(1800);
out.thrust = await state(page);
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
await dbg('d.gas(1)');
// a legal ETC pass on the ground (plaza 0: lanes 0, 2, 4 are ETC; lane 2 is at x = -3.35), at 110 km/h
await dbg('d.teleport(d.plazaZ(0) + 160); d.setX(-3.35); d.setSpeed(110)');
await page.keyboard.down('KeyW');
await wait(() => window.__game.state.z < window.__game.debug.plazaZ(0) + 62, 20000);
out.boomFar = await state(page); // 60 m out: the boom is still down
await wait(() => window.__game.state.z < window.__game.debug.plazaZ(0) + 24, 20000);
out.boomNear = await state(page); // 21 m before the boom line: it has already lifted by itself
await wait(() => window.__game.state.z < window.__game.debug.plazaZ(0) - 30, 20000);
out.etc = await state(page);
// flyover
await dbg('d.teleport(d.plazaZ(0) + 125); d.setSpeed(150)');
await page.keyboard.down('Space');
await wait(() => window.__game.state.z < window.__game.debug.plazaZ(0) - 14, 15000);
out.fly = await state(page);
await page.keyboard.up('Space');
await page.keyboard.up('KeyW');
// language key
await page.keyboard.press('KeyL');
await sleep(150);
out.lang = (await state(page)).lang;
// the stunt: suction on, near the tip, drive off it (W), watch the flip and the reversed landing
await dbg('d.arenaWall(27.5, 0, true)');
out.onWall = await state(page);
await page.keyboard.down('KeyW');
await wait(() => window.__game.state.flipping, 8000);
out.flipStart = await state(page);
await page.keyboard.up('KeyW');
await wait(() => !window.__game.state.flipping, 8000);
out.flipEnd = await state(page);
await wait(() => window.__game.state.grounded && window.__game.state.stunts === 1, 25000);
out.landed = await state(page);
// drive out of the venue gate, fade back to the highway
await page.keyboard.down('KeyW');
await wait(() => window.__game.state.place === 'highway', 40000);
await page.keyboard.up('KeyW');
await sleep(800);
out.back = await state(page);
const r = (s, k) => Object.fromEntries(k.map((x) => [x, typeof s[x] === 'number' ? +s[x].toFixed(2) : s[x]]));
console.log('drive ', JSON.stringify(r(out.drive, ['place', 'kmh', 'car'])));
console.log('thrust', JSON.stringify(r(out.thrust, ['y', 'particles', 'calls'])));
console.log('etc   ', JSON.stringify(r(out.etc, ['etcPasses', 'lives', 'saved', 'fines'])), 'boom lift 60 m out', out.boomFar.etcLift.toFixed(2), '-> 21 m out', out.boomNear.etcLift.toFixed(2));
console.log('fly   ', JSON.stringify(r(out.fly, ['saved', 'lives'])), 'lang', out.lang);
console.log('wall  ', JSON.stringify(r(out.onWall, ['place', 'mode', 'y', 'suction'])), 'flip', JSON.stringify(r(out.flipStart, ['pitch', 'roll', 'dir'])), '->', JSON.stringify(r(out.flipEnd, ['pitch', 'dir', 'heading'])));
console.log('land  ', JSON.stringify(r(out.landed, ['stunts', 'dir', 'grounded', 'z', 'lives'])), '| back', JSON.stringify(r(out.back, ['place', 'dir', 'kmh', 'lives'])));
const ok = out.drive.kmh > 80 && out.thrust.y > 1 && out.thrust.particles > 50
  && out.boomFar.etcLift < 0.05 && out.boomNear.etcLift > 0.9
  && out.etc.etcPasses === 1 && out.etc.lives === 3 && out.etc.fines === 0
  && out.fly.saved >= 45 && out.lang === 'zh'
  && out.onWall.mode === 'wall' && out.flipStart.pitch > 1.7 && out.flipEnd.dir === -1
  && out.landed.stunts === 1 && out.landed.dir === -1 && out.landed.lives === 3
  && out.back.place === 'highway' && out.back.dir === 1 && out.back.kmh > 15;
console.log(ok ? 'PASS' : 'FAIL', '| console:', logs.filter((l) => !/toNonIndexed|AudioContext|\[car\]/.test(l)).slice(0, 4).join(' ; ') || 'clean');
await browser.close();
process.exit(ok ? 0 : 1);
