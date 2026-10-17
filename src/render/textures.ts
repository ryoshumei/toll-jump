// Procedural textures, generated at startup (no external files).
import * as THREE from 'three';

// ---------- tileable noise ----------
function hash(x: number, y: number, s: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Tileable fractal noise in 0..1. (x, y) in 0..1 across the tile. */
export function fbm(x: number, y: number, basePeriod: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += amp * vnoise(x * p, y * p, p, seed + o * 17);
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Wet dark asphalt: albedo (sRGB) and a roughness map (green channel) with puddles. */
export function makeAsphalt(size = 512): { albedo: THREE.DataTexture; rough: THREE.DataTexture } {
  const a = new Uint8Array(size * size * 4);
  const r = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const i = (y * size + x) * 4;
      const patch = fbm(u, v, 4, 4, 11);
      const fine = hash(x, y, 3);
      const stone = hash(x, y, 9);
      let base = 0.15 + (patch - 0.5) * 0.07 + (fine - 0.5) * 0.06;
      if (stone > 0.988) base += 0.09;
      else if (stone < 0.012) base -= 0.05;
      const g = Math.max(0.02, base);
      a[i] = Math.min(255, g * 255 * 0.98);
      a[i + 1] = Math.min(255, g * 255 * 1.02);
      a[i + 2] = Math.min(255, g * 255 * 1.09);
      a[i + 3] = 255;
      // roughness: mostly damp asphalt, glassy puddles where low-frequency noise is high
      const pm = smooth(0.6, 0.68, fbm(u, v, 3, 3, 71));
      let rough = 0.38 + (fbm(u, v, 8, 3, 5) - 0.5) * 0.22 + (fine - 0.5) * 0.08;
      rough = rough * (1 - pm) + 0.14 * pm;
      r[i] = 0;
      r[i + 1] = Math.min(255, Math.max(0, rough * 255));
      r[i + 2] = 0;
      r[i + 3] = 255;
    }
  }
  return { albedo: dataTexture(a, size, size, true), rough: dataTexture(r, size, size, false) };
}

export function makeConcrete(size = 256): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm(x / size, y / size, 6, 4, 23);
      let g = 0.42 + (n - 0.5) * 0.18 + (hash(x, y, 4) - 0.5) * 0.05;
      const joint = x % (size / 2);
      if (joint < 1.5) g *= 0.55;
      d[i] = g * 255; d[i + 1] = g * 252; d[i + 2] = g * 248; d[i + 3] = 255;
    }
  }
  return dataTexture(d, size, size, true);
}

export function makeGround(size = 256): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = fbm(x / size, y / size, 5, 4, 41);
      const g = 0.5 + (n - 0.5) * 0.9 + (hash(x, y, 8) - 0.5) * 0.15;
      d[i] = g * 255 * 0.9; d[i + 1] = g * 255; d[i + 2] = g * 255 * 0.85; d[i + 3] = 255;
    }
  }
  return dataTexture(d, size, size, true);
}

/** Tileable noise in all four channels (used by the plume shader). */
export function makeNoiseTexture(size = 128): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = Math.min(255, fbm(x / size, y / size, 4, 4, 5) * 255);
      d[i] = d[i + 1] = d[i + 2] = d[i + 3] = n;
    }
  }
  const t = dataTexture(d, size, size, false);
  return t;
}

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smoke puff atlas, 2x2 variants. R,G = surface normal (xy) of a lumpy height field, B = height (ambient
 * occlusion), A = coverage. Lit in the smoke shader to look like billowing condensate.
 */
export function makePuffAtlas(cell = 128): THREE.DataTexture {
  const W = cell * 2;
  const data = new Uint8Array(W * W * 4);
  const h = new Float32Array(cell * cell);
  for (let variant = 0; variant < 4; variant++) {
    const rnd = mulberry(1234 + variant * 977);
    const blobs: number[] = [];
    for (let k = 0; k < 22; k++) {
      const ang = rnd() * Math.PI * 2;
      const rad = Math.sqrt(rnd()) * 0.3;
      blobs.push(Math.cos(ang) * rad, Math.sin(ang) * rad, 0.09 + rnd() * 0.16, 0.5 + rnd() * 0.5);
    }
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const px = x / cell - 0.5;
        const py = y / cell - 0.5;
        let s = 0;
        for (let k = 0; k < blobs.length; k += 4) {
          const dx = px - blobs[k];
          const dy = py - blobs[k + 1];
          const t = 1 - (dx * dx + dy * dy) / (blobs[k + 2] * blobs[k + 2]);
          if (t > 0) s += blobs[k + 3] * t * t;
        }
        s += (fbm(x / cell, y / cell, 6, 3, 90 + variant) - 0.5) * 0.35;
        const rr = Math.sqrt(px * px + py * py) * 2; // 0 centre .. 1 edge
        h[y * cell + x] = Math.max(0, s) * (1 - smooth(0.62, 0.98, rr));
      }
    }
    const ox = (variant % 2) * cell;
    const oy = Math.floor(variant / 2) * cell;
    for (let y = 0; y < cell; y++) {
      for (let x = 0; x < cell; x++) {
        const c = h[y * cell + x];
        const l = h[y * cell + Math.max(0, x - 1)];
        const r = h[y * cell + Math.min(cell - 1, x + 1)];
        const u = h[Math.max(0, y - 1) * cell + x];
        const d = h[Math.min(cell - 1, y + 1) * cell + x];
        let nx = (l - r) * 5.5;
        let ny = (d - u) * 5.5; // texture v points up, image y points down
        const nl = Math.sqrt(nx * nx + ny * ny + 1);
        nx /= nl; ny /= nl;
        const px = x / cell - 0.5;
        const py = y / cell - 0.5;
        const rr = Math.sqrt(px * px + py * py) * 2;
        const alpha = smooth(0.03, 0.5, c) * (1 - smooth(0.7, 1.0, rr));
        const i = ((oy + (cell - 1 - y)) * W + ox + x) * 4; // flip so v is up
        data[i] = (nx * 0.5 + 0.5) * 255;
        data[i + 1] = (ny * 0.5 + 0.5) * 255;
        data[i + 2] = Math.min(1, c * 1.2) * 255;
        data[i + 3] = alpha * 255;
      }
    }
  }
  const t = dataTexture(data, W, W, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** White RGBA texture whose alpha is fn(x, y) with x, y in -1..1. For additive decals and glows. */
export function makeAlphaTexture(size: number, fn: (x: number, y: number) => number): THREE.DataTexture {
  const d = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const a = Math.min(1, Math.max(0, fn((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1)));
      d[i] = d[i + 1] = d[i + 2] = 255;
      d[i + 3] = a * 255;
    }
  }
  const t = dataTexture(d, size, size, false);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** Soft round glow (quadratic-ish falloff). */
export const makeGlowTexture = (size = 128, power = 2.2): THREE.DataTexture =>
  makeAlphaTexture(size, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x, y)), power));

/** Soft elliptical pool: bright in the middle, long soft edges. */
export const makePoolTexture = (size = 128): THREE.DataTexture =>
  makeAlphaTexture(size, (x, y) => {
    const d = Math.hypot(x, y);
    return Math.pow(Math.max(0, 1 - d), 1.7) * (0.35 + 0.65 * Math.pow(Math.max(0, 1 - d), 0.8));
  });

export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export const CJK_FONT = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif';

/** Redraw a sign canvas texture in place (for the price board and similar). */
export function redrawText(
  tex: THREE.CanvasTexture, bg: string, fg: string, text: string, fontPx: number, weight = 'bold', glow = 0,
): void {
  const c = tex.image as HTMLCanvasElement;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, c.width, c.height);
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.font = `${weight} ${fontPx}px ${CJK_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (glow > 0) { g.shadowColor = fg; g.shadowBlur = glow; }
  g.fillStyle = fg;
  g.fillText(text, c.width / 2, c.height / 2 + fontPx * 0.04);
  tex.needsUpdate = true;
}

/** Draw a bilingual sign (a Chinese line over an English line, like a real expressway sign) into a 2D context. */
export function drawBilingual(
  g: CanvasRenderingContext2D, W: number, H: number, zh: string, en: string, bg: string, fg: string,
  o: { zhPx?: number; enPx?: number; glow?: number; accent?: string; border?: string } = {},
): void {
  g.clearRect(0, 0, W, H);
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  if (o.accent) {
    g.fillStyle = o.accent;
    g.fillRect(0, 0, W, 6);
    g.fillRect(0, H - 6, W, 6);
  }
  if (o.border) {
    g.strokeStyle = o.border;
    g.lineWidth = Math.max(4, H * 0.025);
    g.strokeRect(g.lineWidth, g.lineWidth, W - 2 * g.lineWidth, H - 2 * g.lineWidth);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = fg;
  g.shadowBlur = o.glow ?? 0;
  g.fillStyle = fg;
  const fit = (text: string, px: number, weight: string, maxW: number) => {
    let p = px;
    g.font = `${weight} ${p}px ${CJK_FONT}`;
    while (g.measureText(text).width > maxW && p > 10) { p -= 2; g.font = `${weight} ${p}px ${CJK_FONT}`; }
  };
  fit(zh, o.zhPx ?? H * 0.42, 'bold', W * 0.94);
  g.fillText(zh, W / 2, H * 0.35);
  fit(en, o.enPx ?? H * 0.2, '600', W * 0.94);
  g.fillText(en, W / 2, H * 0.76);
}

export function bilingualSign(
  zh: string, en: string, W: number, H: number, bg: string, fg: string,
  o: { zhPx?: number; enPx?: number; glow?: number; accent?: string; border?: string } = {},
): THREE.CanvasTexture {
  return canvasTexture(W, H, (g, w, h) => drawBilingual(g, w, h, zh, en, bg, fg, o));
}

/** Redraw a bilingual sign texture in place (the price board changes from plaza to plaza). */
export function redrawBilingual(
  tex: THREE.CanvasTexture, zh: string, en: string, bg: string, fg: string,
  o: { zhPx?: number; enPx?: number; glow?: number; accent?: string; border?: string } = {},
): void {
  const c = tex.image as HTMLCanvasElement;
  drawBilingual(c.getContext('2d')!, c.width, c.height, zh, en, bg, fg, o);
  tex.needsUpdate = true;
}
