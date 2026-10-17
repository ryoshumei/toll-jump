// node tools/compose.mjs out.png cols img1 img2 ...   -> a labelled grid (to compare shots side by side, cheaply)
import { chromium } from 'playwright-core';
import fs from 'node:fs';
const [out, colsArg, ...imgs] = process.argv.slice(2);
const cols = Number(colsArg) || 2;
const W = Number(process.env.CELL_W || 800);
const cells = imgs.map((p) => {
  const [path, label] = p.split('::');
  const b64 = fs.readFileSync(path).toString('base64');
  const ext = path.endsWith('.jpg') ? 'jpeg' : 'png';
  return `<figure><img src="data:image/${ext};base64,${b64}"><figcaption>${label ?? path.split('/').pop()}</figcaption></figure>`;
}).join('');
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:4px">
<style>figure{margin:0;position:relative}img{width:${W}px;display:block}figcaption{position:absolute;left:6px;top:4px;font:12px monospace;color:#0f0;background:#000a;padding:1px 5px}</style>${cells}</body>`;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: cols * (W + 4), height: 400 } });
await page.setContent(html);
await page.waitForTimeout(400);
await page.screenshot({ path: out, fullPage: true });
await browser.close();
