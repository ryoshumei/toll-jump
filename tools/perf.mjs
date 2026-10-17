// Frame-time measurement on the production build. Method: Playwright + Chromium headless shell on the real GPU
// (ANGLE/Metal). Frame times are rAF-to-rAF deltas from the game's own 600-frame ring buffer (window.__game.perf).
//   node tools/perf.mjs [dpr=1] [uncapped=0]     (needs `npm run preview` on :4173)
import { launch, open, sleep, state, gl } from './lib.mjs';
const dpr = Number(process.argv[2] || 1);
const uncapped = process.argv[3] === '1';
// optional: where to measure (z). DRIVE_Z: start of the driving run; HOVER_Z: where to hover
const DRIVE_Z = process.env.DRIVE_Z, HOVER_Z = process.env.HOVER_Z;
const { browser, page } = await launch({
  width: 1600, height: 900, dpr,
  extra: uncapped ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [],
});
const version = browser.version();
const renderer = await gl(page);
await open(page, '?autostart');
const wait = (cond, t = 25000) => page.waitForFunction(cond, null, { timeout: t, polling: 50 });
const row = async (name) => {
  const p = await page.evaluate(() => window.__game.perf(600));
  const s = await state(page);
  console.log(`${name.padEnd(8)} n=${p.n} avg=${p.avg.toFixed(2)}ms p95=${p.p95.toFixed(2)} p99=${p.p99.toFixed(2)} max=${p.max.toFixed(1)} fps=${p.fps.toFixed(0)} | particles=${s.particles} calls=${s.calls} tris=${(s.triangles / 1000).toFixed(0)}k dpr=${s.dpr} z=${s.z.toFixed(0)}`);
};
console.log(`browser=${version} gpu=${renderer} viewport=1600x900 dpr=${dpr}${uncapped ? ' UNCAPPED' : ''}`);
if (DRIVE_Z) await page.evaluate((z) => window.__game.debug.teleport(Number(z)), DRIVE_Z);
// driving: hold W through the acceleration and then at ~300 km/h
await page.keyboard.down('KeyW');
await wait(() => window.__game.state.kmh > 150);
await sleep(4000);
await sleep(Number(uncapped ? 6000 : 9000));
await row('driving');
await page.keyboard.up('KeyW');
if (HOVER_Z) await page.evaluate((z) => { const d = window.__game.debug; d.teleport(Number(z) === 0 ? d.plazaZ(0) + 60 : Number(z) === 1 ? d.exitZ(0) + 60 : Number(z)); }, HOVER_Z);
// hovering in thick smoke: climb to ~3 m, S + Space to stop and hold, let the clouds build, keep the tank topped up
await page.evaluate(() => window.__game.debug.hover(3.2));
await wait(() => window.__game.state.y > 3);
await page.keyboard.down('KeyS');
await wait(() => window.__game.state.kmh < 8);
for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__game.debug.gas(1)); await sleep(700); }
await row('hovering');
await browser.close();
