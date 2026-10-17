// Shared Playwright helpers. GPU path that works on this machine: the Chromium headless shell with ANGLE/Metal.
import { chromium } from 'playwright-core';

export const BASE = process.env.BASE || 'http://localhost:4173/';

export async function launch({ width = 1600, height = 900, dpr = 1, gpu = true, extra = [] } = {}) {
  const args = [...(gpu
    ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu', '--enable-zero-copy']
    : []), ...extra];
  const browser = await chromium.launch({ headless: true, args });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || m.type() === 'warning' || /THREE|Shader|GLSL|\[car\]/.test(t)) logs.push(`[${m.type()}] ${t.slice(0, 400)}`);
  });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 400)}`));
  return { browser, ctx, page, logs };
}

export async function open(page, query = '') {
  await page.goto(BASE + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.state.phase !== 'loading', null, { timeout: 90000 });
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const state = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)));
export const gl = (page) => page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const e = c.getExtension('WEBGL_debug_renderer_info');
  return e ? c.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
