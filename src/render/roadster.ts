// The hero car. Two interchangeable models behind one interface:
//  - a procedural faceted loft (fallback, built here), faithful to refs/roadster.png
//  - an optional GLB (public/models/roadster.glb) following docs/CAR_MODEL.md
// Local frame: origin on the ground plane midway between the axles, nose toward -Z, +X right, +Y up.
import * as THREE from 'three';
import { shared } from './environment';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { CAR, GLB, NOZZLES } from '../config';
import { canvasTexture, CJK_FONT, makeGlowTexture } from './textures';

export interface NozzleAnchor { pos: THREE.Vector3; dir: THREE.Vector3 }

export interface CarModel {
  kind: 'procedural' | 'glb';
  root: THREE.Group;
  down: NozzleAnchor[]; // FL, FR, RL, RR (fire downward)
  rear: NozzleAnchor[]; // L, R (fire backward)
  rcs: NozzleAnchor[]; // L front, L rear, R front, R rear (fire sideways)
  /** spin: wheel rotation about the axle (rad, increasing = rolling forward); steer: front wheel angle (rad, + = right). */
  setWheels(spin: number, steer: number): void;
  /** brake 0..1 brightens the tail bar; boost 0..1 adds a little more. */
  setLights(brake: number, boost: number): void;
  /** Glow of each nozzle ring: down[4], rear[2], rcs[4], all 0..1. */
  setNozzleGlow(levels: Float32Array): void;
  /** Underside panel glow 0..1 (lit by the thruster plumes). */
  setUnderGlow(level: number): void;
  dispose(): void;
}

const D = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const anchors = (pts: [number, number, number][], dir: THREE.Vector3): NozzleAnchor[] =>
  pts.map((p) => ({ pos: D(p[0], p[1], p[2]), dir: dir.clone() }));

// ------------------------------------------------------------------------------------------------
// procedural loft
// ------------------------------------------------------------------------------------------------
const PAINT = 0, GLASS = 1, BLACK = 2, FLOOR = 3;
type Pt = [number, number];

const pl = (z: number, p: number[]): number => {
  if (z <= p[0]) return p[1];
  for (let i = 2; i < p.length; i += 2) {
    if (z <= p[i]) { const t = (z - p[i - 2]) / (p[i] - p[i - 2]); return p[i - 1] + t * (p[i + 1] - p[i - 1]); }
  }
  return p[p.length - 1];
};

const Y_TOP = [-2.2, 0.62, 0.22, 1.15, 1.7, 0.845, 2.12, 0.83];
const Y_BELT = [-2.2, 0.55, -1.15, 0.78, -0.7, 0.82, 0.2, 0.87, 1.62, 0.86, 2.12, 0.8];
const W_BELT = [-2.2, 0.7, -1.6, 0.94, -1.3, 0.99, 1.7, 1.0, 2.12, 0.95];
const W_SIDE = [-2.2, 0.69, -1.7, 0.92, -1.3, 1.0, 1.75, 1.0, 2.12, 0.94];
const W_ROOF = [-1.15, 0.8, 0.22, 0.66, 1.62, 0.56];
const Y_CHAR = [-2.2, 0.3, -1.5, 0.32, 0.0, 0.34, 0.8, 0.42, 1.3, 0.6, 1.9, 0.74, 2.12, 0.78];
const GLASS_Z0 = -1.15;
const GLASS_Z1 = 1.62;
const Y_ROCKER = 0.2;
const Y_FLOOR = 0.14;
const WHEEL_Z = CAR.wheelbase / 2;
const ARCH_R = 0.4;

function archY(z: number): number {
  let y = Y_ROCKER;
  for (const c of [-WHEEL_Z, WHEEL_Z]) {
    const d = Math.abs(z - c);
    if (d <= ARCH_R) y = Math.max(y, CAR.wheelRadius + Math.sqrt(ARCH_R * ARCH_R - d * d));
  }
  return y;
}

interface Section { pts: Pt[]; tags: number[] }

function bevelPts(a: Pt, c: Pt, b: Pt, size: number): [Pt, Pt] {
  const l1 = Math.hypot(a[0] - c[0], a[1] - c[1]);
  const l2 = Math.hypot(b[0] - c[0], b[1] - c[1]);
  const s = Math.min(size, 0.4 * l1, 0.4 * l2);
  const p1: Pt = l1 > 1e-9 ? [c[0] + ((a[0] - c[0]) / l1) * s, c[1] + ((a[1] - c[1]) / l1) * s] : [c[0], c[1]];
  const p2: Pt = l2 > 1e-9 ? [c[0] + ((b[0] - c[0]) / l2) * s, c[1] + ((b[1] - c[1]) / l2) * s] : [c[0], c[1]];
  return [p1, p2];
}

function section(z: number, inset = 1): Section {
  const glass = z >= GLASS_Z0 && z <= GLASS_Z1;
  const yTop = pl(z, Y_TOP);
  const wBelt = pl(z, W_BELT);
  const wSide = pl(z, W_SIDE);
  const yArch = archY(z);
  const yBelt = glass ? pl(z, Y_BELT) : Math.min(pl(z, Y_BELT), yTop - 0.07);
  const wRoof = glass ? pl(z, W_ROOF) : wBelt - 0.02;
  let yChar = Math.max(pl(z, Y_CHAR), yArch + 0.05);
  yChar = Math.min(yChar, yBelt - 0.02);
  const c: Pt[] = [
    [0, yTop],
    [wRoof, yTop - 0.045],
    [wBelt, yBelt],
    [wSide, yChar],
    [wSide - 0.03, yArch],
    [0.62, yArch],
    [0.62, Y_FLOOR],
    [0, Y_FLOOR],
  ];
  const bev = [0, 0.03, 0.02, 0.015, 0.02, 0, 0, 0];
  const roofTag = glass ? GLASS : PAINT;
  const edgeTag = [roofTag, roofTag, PAINT, BLACK, BLACK, BLACK, FLOOR]; // e0..e6 between corners i, i+1
  const half: Pt[] = [];
  const tags: number[] = [];
  for (let i = 0; i < 8; i++) {
    if (bev[i] > 0) {
      const [p1, p2] = bevelPts(c[i - 1], c[i], c[i + 1], bev[i]);
      half.push(p1, p2);
      tags.push(edgeTag[i - 1]); // the edge arriving at this corner
      tags.push(i === 2 ? BLACK : i === 1 ? roofTag : i === 3 ? PAINT : BLACK); // the bevel itself
    } else {
      half.push(c[i]);
      if (i > 0) tags.push(edgeTag[i - 1]);
    }
  }
  // half has 12 points, tags has 11 edges
  const pts: Pt[] = [...half];
  for (let k = half.length - 2; k >= 1; k--) pts.push([-half[k][0], half[k][1]]);
  const full: number[] = [...tags];
  for (let k = tags.length - 1; k >= 0; k--) full.push(tags[k]);
  if (inset !== 1) {
    let cx = 0, cy = 0;
    for (const p of pts) { cx += p[0]; cy += p[1]; }
    cx /= pts.length; cy /= pts.length;
    for (const p of pts) { p[0] = cx + (p[0] - cx) * inset; p[1] = cy + (p[1] - cy) * inset; }
  }
  return { pts, tags: full };
}

function stations(): { z: number; inset: number }[] {
  const zs = new Set<number>([-2.17, -2.0, -1.85, -0.75, -0.4, 0, 0.22, 0.6, 1.9, 2.0, 2.12, GLASS_Z0 - 0.01, GLASS_Z0, GLASS_Z1, GLASS_Z1 + 0.01]);
  const offs = [-0.4001, -0.4, -0.37, -0.32, -0.24, -0.13, 0, 0.13, 0.24, 0.32, 0.37, 0.4, 0.4001];
  for (const c of [-WHEEL_Z, WHEEL_Z]) for (const o of offs) zs.add(+(c + o).toFixed(4));
  const list = [...zs].sort((a, b) => a - b).map((z) => ({ z, inset: 1 }));
  list.unshift({ z: -2.2, inset: 0.93 });
  list.push({ z: 2.15, inset: 0.94 });
  return list;
}

function buildBodyGeometries(): THREE.BufferGeometry[] {
  const st = stations();
  const secs = st.map((s) => section(s.z, s.inset));
  const buckets: number[][] = [[], [], [], []];
  const tri = (b: number[], a: number[], c: number[], d: number[]) => {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2];
    const vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    if (nx * nx + ny * ny + nz * nz < 1e-12) return; // degenerate (collapsed edge)
    b.push(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
  };
  for (let i = 0; i < secs.length - 1; i++) {
    const A = secs[i], B = secs[i + 1];
    const za = st[i].z, zb = st[i + 1].z;
    const m = A.pts.length;
    for (let j = 0; j < m; j++) {
      const k = (j + 1) % m;
      let tag = A.tags[j];
      if (tag !== B.tags[j]) tag = BLACK;
      const a0 = [A.pts[j][0], A.pts[j][1], za], a1 = [A.pts[k][0], A.pts[k][1], za];
      const b0 = [B.pts[j][0], B.pts[j][1], zb], b1 = [B.pts[k][0], B.pts[k][1], zb];
      tri(buckets[tag], a0, b0, a1);
      tri(buckets[tag], a1, b0, b1);
    }
  }
  // end caps (flat fans)
  const cap = (s: Section, z: number, facing: number) => {
    let cx = 0, cy = 0;
    for (const p of s.pts) { cx += p[0]; cy += p[1]; }
    cx /= s.pts.length; cy /= s.pts.length;
    for (let j = 0; j < s.pts.length; j++) {
      const p = s.pts[j], q = s.pts[(j + 1) % s.pts.length];
      const tag = facing < 0 ? ((p[1] + q[1] + cy) / 3 < 0.36 ? BLACK : PAINT) : BLACK;
      const c3 = [cx, cy, z], p3 = [p[0], p[1], z], q3 = [q[0], q[1], z];
      if (facing < 0) tri(buckets[tag], c3, p3, q3);
      else tri(buckets[tag], c3, q3, p3);
    }
  };
  cap(secs[0], st[0].z, -1);
  cap(secs[secs.length - 1], st[st.length - 1].z, 1);
  return buckets.map((b, tag) => {
    let g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(b), 3));
    if (tag === GLASS) g = mergeVertices(g, 1e-4); // the glass shades smoothly across its facets
    g.computeVertexNormals();
    return g;
  });
}

/** x on the side panel at height y (between the character line and the belt), for placing seams. */
function sideX(z: number, y: number): number {
  const wSide = pl(z, W_SIDE), wBelt = pl(z, W_BELT);
  const yBelt = pl(z, Y_BELT);
  const yChar = Math.max(pl(z, Y_CHAR), archY(z) + 0.05);
  const t = Math.min(1, Math.max(0, (y - yChar) / Math.max(0.01, yBelt - yChar)));
  return wSide + (wBelt - wSide) * t;
}

/** A ribbon along a 3D polyline, flat to the surface it lies on (width in the plane of `up`). */
function ribbon(points: number[][], width: number, side: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const t = new THREE.Vector3(), o = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    t.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    o.copy(side).cross(t).normalize().multiplyScalar(width / 2); // perpendicular to path, in the surface
    // side is the surface normal; o lies in the surface
    pos.push(points[i][0] + o.x, points[i][1] + o.y, points[i][2] + o.z, points[i][0] - o.x, points[i][1] - o.y, points[i][2] - o.z);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function buildTrimGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const nrm = new THREE.Vector3(sx, 0, 0);
    const X = (z: number, y: number) => sx * (sideX(z, y) + 0.0035);
    // door cut lines (front and rear shut lines) and the sill line
    for (const z of [-0.92, 0.6]) {
      const yb = pl(z, Y_BELT) - 0.01;
      const yc = Math.max(pl(z, Y_CHAR), archY(z) + 0.05) + 0.02;
      const pts: number[][] = [];
      for (let k = 0; k <= 6; k++) { const y = yb + (yc - yb) * (k / 6); pts.push([X(z, y), y, z]); }
      parts.push(ribbon(pts, 0.007, nrm));
    }
    const sill: number[][] = [];
    for (let k = 0; k <= 10; k++) {
      const z = -0.92 + (0.6 + 0.92) * (k / 10);
      const y = Math.max(pl(z, Y_CHAR), archY(z) + 0.05) + 0.02;
      sill.push([X(z, y), y, z]);
    }
    parts.push(ribbon(sill, 0.007, nrm));
    // wheel arch lips: a thin raised rim around each arch
    for (const c of [-WHEEL_Z, WHEEL_Z]) {
      const pts: number[][] = [];
      const x = sx * (pl(c, W_SIDE) - 0.03 + 0.004);
      pts.push([x, Y_ROCKER, c - ARCH_R - 0.012]);
      pts.push([x, CAR.wheelRadius, c - ARCH_R - 0.012]);
      for (let k = 1; k < 12; k++) {
        const a = Math.PI - (Math.PI * k) / 12;
        pts.push([x, CAR.wheelRadius + Math.sin(a) * (ARCH_R + 0.012), c + Math.cos(a) * (ARCH_R + 0.012)]);
      }
      pts.push([x, CAR.wheelRadius, c + ARCH_R + 0.012]);
      pts.push([x, Y_ROCKER, c + ARCH_R + 0.012]);
      parts.push(ribbon(pts, 0.026, nrm));
    }
  }
  // hood shut line and the rear-glass base seam across the top
  for (const z of [-1.6, GLASS_Z1 + 0.012]) {
    const pts: number[][] = [];
    for (let k = -6; k <= 6; k++) {
      const x = (k / 6) * (z < 0 ? 0.88 : 0.58);
      pts.push([x, pl(z, Y_TOP) - Math.abs(x) * 0.07 + 0.003, z]);
    }
    parts.push(ribbon(pts, 0.007, new THREE.Vector3(0, 1, 0)));
  }
  return mergeGeometries(parts.map((p) => p.toNonIndexed()))!;
}

function plateTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 56, (g, w, h) => {
    g.fillStyle = '#d9dad8';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#2a2a2c';
    g.lineWidth = 3;
    g.strokeRect(4, 4, w - 8, h - 8);
    g.fillStyle = '#26272a';
    g.font = `600 36px "Helvetica Neue",Arial,${CJK_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // wide letter spacing, like the reference plate
    const text = 'RDSTR';
    let x = w / 2 - (text.length - 1) * 21;
    for (const ch of text) { g.fillText(ch, x, h / 2 + 2); x += 42; }
  });
}

function underGlowTexture(): THREE.CanvasTexture {
  return canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const cols = 4, rows = 9;
    let s = 5;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        s = (s * 16807) % 2147483647;
        const b = 0.55 + 0.45 * (s / 2147483647);
        g.fillStyle = `rgb(${Math.round(255 * b)},${Math.round(92 * b)},${Math.round(44 * b)})`;
        g.fillRect(c * (w / cols) + 4, r * (h / rows) + 4, w / cols - 8, h / rows - 8);
      }
    }
  });
}

function wheelGeometries(): { tire: THREE.BufferGeometry; disc: THREE.BufferGeometry; star: THREE.BufferGeometry } {
  // tire: low-profile, with a defined sidewall bulge and shoulder (profile revolved about the axle)
  const prof: THREE.Vector2[] = [
    [0.238, -0.118], [0.262, -0.138], [0.3, -0.148], [0.335, -0.146], [0.352, -0.13], [0.36, -0.1], [0.361, -0.06],
    [0.361, 0.06], [0.36, 0.1], [0.352, 0.13], [0.335, 0.146], [0.3, 0.148], [0.262, 0.138], [0.238, 0.118], [0.232, 0.0],
  ].map((p) => new THREE.Vector2(p[0], p[1]));
  const tire = new THREE.LatheGeometry(prof, 40);
  tire.rotateZ(Math.PI / 2); // axle along X

  // light-grey aero disc, slightly dished (outer face at +x)
  const dp: THREE.Vector2[] = [[0.0, 0.1], [0.06, 0.108], [0.18, 0.118], [0.258, 0.124], [0.262, 0.112], [0.262, 0.05], [0.0, 0.05]]
    .map((p) => new THREE.Vector2(p[0], p[1]));
  const disc = new THREE.LatheGeometry(dp, 40);
  disc.rotateZ(Math.PI / 2);

  // five-spoke star on top of the disc
  const shape = new THREE.Shape();
  const arms = 5, tip = 0.252, valley = 0.082;
  for (let i = 0; i < arms; i++) {
    const a = (i / arms) * Math.PI * 2 + Math.PI / 2;
    const half = 0.17, narrow = 0.105;
    const pts: [number, number][] = [
      [valley, a - half - 0.28], [0.15, a - narrow - 0.03], [tip, a - 0.075], [tip, a + 0.075],
      [0.15, a + narrow + 0.03], [valley, a + half + 0.28],
    ];
    pts.forEach((p, k) => {
      const x = Math.cos(p[1]) * p[0], y = Math.sin(p[1]) * p[0];
      if (i === 0 && k === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    });
  }
  shape.closePath();
  const star = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1 });
  star.rotateY(Math.PI / 2); // shape in the YZ plane, extruded along +X
  star.translate(0.126, 0, 0);
  return { tire, disc, star };
}

export function buildProceduralCar(): CarModel {
  const root = new THREE.Group();
  root.name = 'roadster-procedural';
  const geos: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const tex: THREE.Texture[] = [];
  const keep = <T extends THREE.BufferGeometry>(g: T) => { geos.push(g); return g; };
  const mat = <T extends THREE.Material>(m: T) => { mats.push(m); return m; };

  const paint = mat(new THREE.MeshPhysicalMaterial({ color: 0xd9d6d0, metalness: 0.6, roughness: 0.32, clearcoat: 0.35, clearcoatRoughness: 0.18, envMap: shared.env, envMapIntensity: 0.42 }));
  const glass = mat(new THREE.MeshPhysicalMaterial({ color: 0x6b4a36, metalness: 0.8, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.03, envMap: shared.env, envMapIntensity: 0.7 }));
  const black = mat(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.35, roughness: 0.42, envMap: shared.env, envMapIntensity: 0.5 }));
  const floor = mat(new THREE.MeshStandardMaterial({ color: 0x050506, metalness: 0.2, roughness: 0.85 }));
  const bodies = buildBodyGeometries();
  const bodyMats = [paint, glass, black, floor];
  bodies.forEach((g, i) => {
    keep(g);
    const m = new THREE.Mesh(g, bodyMats[i]);
    m.castShadow = i !== 3;
    m.receiveShadow = i === 0 || i === 2;
    root.add(m);
  });

  // trim: panel gaps, arch lips
  const trim = new THREE.Mesh(keep(buildTrimGeometry()), mat(new THREE.MeshStandardMaterial({
    color: 0x060607, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  })));
  root.add(trim);

  // rear blade: a thin beveled slab overhanging the tail
  const bs = new THREE.Shape();
  bs.moveTo(-0.96, 2.0); bs.lineTo(0.96, 2.0); bs.lineTo(1.04, 2.34); bs.lineTo(-1.04, 2.34); bs.closePath();
  const bladeG = keep(new THREE.ExtrudeGeometry(bs, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 1 }));
  bladeG.rotateX(Math.PI / 2); // plan-view y becomes world z, depth goes down
  const blade = new THREE.Mesh(bladeG, paint);
  blade.position.y = 0.834;
  blade.castShadow = true;
  root.add(blade);
  const bladeUnder = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.0, 0.34)), black);
  bladeUnder.rotation.x = Math.PI / 2;
  bladeUnder.position.set(0, 0.8035, 2.168);
  root.add(bladeUnder);

  // tail LED bar: hot core, bar body, soft glow
  const tailMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.09, 0.07) }));
  const coreMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 3.6, 3.0) }));
  const tail = new THREE.Mesh(keep(new RoundedBoxGeometry(1.86, 0.03, 0.02, 2, 0.009)), tailMat);
  tail.position.set(0, 0.772, 2.158);
  root.add(tail);
  const core = new THREE.Mesh(keep(new RoundedBoxGeometry(1.8, 0.009, 0.012, 1, 0.004)), coreMat);
  core.position.set(0, 0.772, 2.168);
  root.add(core);
  const glowTex = makeGlowTexture(128, 2.4);
  tex.push(glowTex);
  const tailGlowMat = mat(new THREE.MeshBasicMaterial({
    map: glowTex, color: new THREE.Color(1.5, 0.05, 0.04), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  }));
  const tailGlow = new THREE.Mesh(keep(new THREE.PlaneGeometry(2.7, 0.55)), tailGlowMat);
  tailGlow.position.set(0, 0.76, 2.19);
  tailGlow.renderOrder = 3;
  root.add(tailGlow);

  // front light bar, side markers
  const headMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(4.6, 4.9, 5.8) }));
  const head = new THREE.Mesh(keep(new RoundedBoxGeometry(1.4, 0.024, 0.03, 2, 0.01)), headMat);
  head.position.set(0, 0.545, -2.2);
  root.add(head);
  const markMat = mat(new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.25, 0.1) }));
  const markG = keep(new RoundedBoxGeometry(0.03, 0.034, 0.15, 1, 0.012));
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(markG, markMat);
    m.position.set(sx * 0.985, 0.655, -0.92);
    root.add(m);
  }

  // plate
  const plateTex = plateTexture();
  tex.push(plateTex);
  const plate = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.52, 0.113)), mat(new THREE.MeshStandardMaterial({ map: plateTex, roughness: 0.5, metalness: 0.1 })));
  plate.position.set(0, 0.505, 2.158);
  root.add(plate);
  const plateRim = new THREE.Mesh(keep(new RoundedBoxGeometry(0.56, 0.15, 0.01, 1, 0.004)), black);
  plateRim.position.set(0, 0.505, 2.152);
  root.add(plateRim);

  // diffuser strakes and the two rear nozzle bores
  const strakes: THREE.BufferGeometry[] = [];
  for (let i = -3; i <= 3; i++) {
    const g = new RoundedBoxGeometry(0.02, 0.19, 0.14, 1, 0.006);
    g.translate(i * 0.2, 0.3, 2.215);
    strakes.push(g.toNonIndexed());
  }
  const diffuser = new THREE.Mesh(keep(mergeGeometries(strakes)!), black);
  root.add(diffuser);
  const boreG = keep(new THREE.CylinderGeometry(0.07, 0.07, 0.09, 20, 1, true));
  boreG.rotateX(Math.PI / 2);
  for (const r of NOZZLES.rear) {
    const bore = new THREE.Mesh(boreG, mat(new THREE.MeshStandardMaterial({ color: 0x020203, roughness: 0.6, side: THREE.DoubleSide })));
    bore.position.set(r[0], r[1], 2.2);
    root.add(bore);
  }

  // underside glow panel (the orange-red grid seen lit under the hovering car)
  const ugTex = underGlowTexture();
  tex.push(ugTex);
  const ugMat = mat(new THREE.MeshBasicMaterial({ map: ugTex, color: new THREE.Color(0, 0, 0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  const ug = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.0, 2.7)), ugMat);
  ug.rotation.x = Math.PI / 2;
  ug.position.set(0, 0.128, 0);
  root.add(ug);

  // wheels (instanced: tire, aero disc, star)
  const wg = wheelGeometries();
  keep(wg.tire); keep(wg.disc); keep(wg.star);
  const tireM = mat(new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.78, metalness: 0.0, envMap: shared.env, envMapIntensity: 0.3 }));
  const discM = mat(new THREE.MeshStandardMaterial({ color: 0xb4b3af, roughness: 0.38, metalness: 0.55, envMap: shared.env, envMapIntensity: 0.55 }));
  const starM = mat(new THREE.MeshStandardMaterial({ color: 0x060607, roughness: 0.22, metalness: 0.85, envMap: shared.env, envMapIntensity: 0.7 }));
  const tires = new THREE.InstancedMesh(wg.tire, tireM, 4);
  const discs = new THREE.InstancedMesh(wg.disc, discM, 4);
  const stars = new THREE.InstancedMesh(wg.star, starM, 4);
  for (const m of [tires, discs, stars]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.castShadow = true;
    m.frustumCulled = false;
    root.add(m);
  }
  // nozzle rings
  const ringG = keep(new THREE.TorusGeometry(0.055, 0.014, 8, 22));
  const rings = new THREE.InstancedMesh(ringG, mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), 10);
  rings.frustumCulled = false;
  const ringQ = [new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2), new THREE.Quaternion(),
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2)];
  const rm = new THREE.Matrix4();
  const one = new THREE.Vector3(1, 1, 1);
  const place = (i: number, p: [number, number, number], q: THREE.Quaternion) => {
    rm.compose(D(p[0], p[1], p[2]), q, one);
    rings.setMatrixAt(i, rm);
    rings.setColorAt(i, new THREE.Color(0.02, 0.02, 0.024));
  };
  NOZZLES.down.forEach((p, i) => place(i, p, ringQ[0]));
  NOZZLES.rear.forEach((p, i) => place(4 + i, [p[0], p[1], p[2] + 0.04], ringQ[1]));
  NOZZLES.rcs.forEach((p, i) => place(6 + i, p, i < 2 ? ringQ[2] : ringQ[3]));
  rings.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  root.add(rings);

  // per-frame state
  const wheelPos: [number, number][] = [[-0.85, -WHEEL_Z], [0.85, -WHEEL_Z], [-0.85, WHEEL_Z], [0.85, WHEEL_Z]];
  const mat4 = new THREE.Matrix4();
  const qSteer = new THREE.Quaternion(), qSpin = new THREE.Quaternion(), qSide = new THREE.Quaternion(), qAll = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);
  const tmpP = new THREE.Vector3();
  const tmpC = new THREE.Color();

  const model: CarModel = {
    kind: 'procedural',
    root,
    down: anchors(NOZZLES.down, D(0, -1, 0)),
    rear: anchors(NOZZLES.rear, D(0, 0, 1)),
    rcs: NOZZLES.rcs.map((p, i) => ({ pos: D(p[0], p[1], p[2]), dir: D(i < 2 ? -1 : 1, 0, 0) })),
    setWheels(spin, steer) {
      for (let i = 0; i < 4; i++) {
        const left = i % 2 === 0;
        qSteer.setFromAxisAngle(AY, i < 2 ? -steer : 0);
        qSpin.setFromAxisAngle(AX, -spin);
        qSide.setFromAxisAngle(AY, left ? Math.PI : 0); // left wheels face -X
        qAll.copy(qSteer).multiply(qSide).multiply(qSpin);
        tmpP.set(wheelPos[i][0], CAR.wheelRadius, wheelPos[i][1]);
        mat4.compose(tmpP, qAll, one);
        tires.setMatrixAt(i, mat4);
        discs.setMatrixAt(i, mat4);
        stars.setMatrixAt(i, mat4);
      }
      tires.instanceMatrix.needsUpdate = true;
      discs.instanceMatrix.needsUpdate = true;
      stars.instanceMatrix.needsUpdate = true;
    },
    setLights(brake, boost) {
      const b = Math.min(1, brake);
      tailMat.color.setRGB(3.4 + b * 5.0 + boost * 0.8, 0.09 + b * 0.35, 0.07 + b * 0.25);
      coreMat.color.setRGB(9 + b * 5, 3.6 + b * 2, 3.0 + b * 1.6);
      tailGlowMat.color.setRGB(1.5 + b * 2.4, 0.05 + b * 0.2, 0.04 + b * 0.15);
    },
    setNozzleGlow(levels) {
      for (let i = 0; i < 10; i++) {
        const l = levels[i];
        tmpC.setRGB(0.02 + l * 3.0, 0.02 + l * 3.5, 0.024 + l * 4.2);
        rings.setColorAt(i, tmpC);
      }
      rings.instanceColor!.needsUpdate = true;
    },
    setUnderGlow(level) {
      ugMat.color.setRGB(level * 2.4, level * 2.4, level * 2.4);
    },
    dispose() {
      geos.forEach((g) => g.dispose());
      mats.forEach((m) => m.dispose());
      tex.forEach((t) => t.dispose());
    },
  };
  model.setWheels(0, 0);
  model.setNozzleGlow(new Float32Array(10));
  return model;
}

// ------------------------------------------------------------------------------------------------
// GLB model (docs/CAR_MODEL.md)
// ------------------------------------------------------------------------------------------------
const EMISSIVE_BOOST = 3.0;

export async function loadGlbCar(url: string): Promise<CarModel> {
  const gltf = await new GLTFLoader().loadAsync(url);
  return wrapGlb(gltf.scene);
}

function findNode(scene: THREE.Object3D, test: (n: string) => boolean): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  scene.traverse((o) => { if (!found && test(o.name)) found = o; });
  return found;
}

function wrapGlb(scene: THREE.Object3D): CarModel {
  const root = new THREE.Group();
  root.name = 'roadster-glb';
  const inner = new THREE.Group();
  inner.add(scene);
  root.add(inner);

  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const v = new THREE.Vector3();
  scene.updateMatrixWorld(true);
  box.setFromObject(scene);
  box.getSize(size);
  let yaw = GLB.rotationY;
  if (size.x > size.z * 1.25) yaw += Math.PI / 2; // long axis along X: turn it
  inner.rotation.y = yaw;
  inner.updateMatrixWorld(true);

  const tailNode = findNode(scene, (n) => n === 'taillight' || n.startsWith('taillight'));
  const headNode = findNode(scene, (n) => n === 'headlight' || n.startsWith('headlight'));
  if (tailNode && headNode) {
    const tz = box.setFromObject(tailNode).getCenter(v).z;
    const hz = box.setFromObject(headNode).getCenter(v).z;
    if (tz < hz) { yaw += Math.PI; inner.rotation.y = yaw; inner.updateMatrixWorld(true); } // the nose must point to -Z
  }

  // auto-scale to 4.4 m, sit on the ground, centre laterally and between the axles
  box.setFromObject(inner);
  box.getSize(size);
  const k = GLB.targetLength / Math.max(0.001, size.z);
  inner.scale.setScalar(k);
  inner.updateMatrixWorld(true);
  box.setFromObject(inner);
  const wheelNodes = ['wheel_FL', 'wheel_FR', 'wheel_RL', 'wheel_RR'].map((n) => findNode(scene, (x) => x === n));
  let cz = (box.min.z + box.max.z) / 2;
  if (wheelNodes.every((w) => w)) {
    let s = 0;
    for (const w of wheelNodes) s += w!.getWorldPosition(v).z;
    cz = s / 4;
  }
  inner.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -cz);
  root.updateMatrixWorld(true);

  const toLocal = (n: THREE.Object3D | null, fallback: [number, number, number]): THREE.Vector3 => {
    if (!n) return D(fallback[0], fallback[1], fallback[2]);
    return root.worldToLocal(n.getWorldPosition(new THREE.Vector3()));
  };
  const names = (ns: string[], fb: [number, number, number][], dir: (i: number) => THREE.Vector3): NozzleAnchor[] =>
    ns.map((n, i) => ({ pos: toLocal(findNode(scene, (x) => x === n), fb[i]), dir: dir(i) }));
  const down = names(['nozzle_down_FL', 'nozzle_down_FR', 'nozzle_down_RL', 'nozzle_down_RR'], NOZZLES.down, () => D(0, -1, 0));
  const rear = names(['nozzle_rear_L', 'nozzle_rear_R'], NOZZLES.rear, () => D(0, 0, 1));
  const rcs = names(['rcs_L_front', 'rcs_L_rear', 'rcs_R_front', 'rcs_R_rear'], NOZZLES.rcs, (i) => D(i < 2 ? -1 : 1, 0, 0));

  // wheels: spin on local X, steer the front pair about the parent's Y; keep each node's rest rotation
  interface Wheel { node: THREE.Object3D; rest: THREE.Quaternion; sign: number; front: boolean }
  const wheels: Wheel[] = [];
  wheelNodes.forEach((n, i) => {
    if (!n) return;
    const rest = n.quaternion.clone();
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(rest);
    wheels.push({ node: n, rest, sign: axis.x >= 0 ? 1 : -1, front: i < 2 });
  });
  const qS = new THREE.Quaternion(), qP = new THREE.Quaternion();
  const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);

  // emissive parts by name
  interface Em { mat: THREE.MeshStandardMaterial; base: THREE.Color; kind: 'tail' | 'head' | 'marker' }
  const ems: Em[] = [];
  const glowTex = makeGlowTexture(128, 2.4);
  let tailGlow: THREE.Mesh | null = null;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    for (const mm of Array.isArray(m.material) ? m.material : [m.material]) {
      const s = mm as THREE.MeshStandardMaterial;
      if (s.isMeshStandardMaterial) { s.envMap = shared.env; s.envMapIntensity = 0.65; }
    }
    const kind = o.name.startsWith('taillight') ? 'tail' : o.name.startsWith('headlight') ? 'head' : o.name.startsWith('marker_') ? 'marker' : null;
    if (!kind) return;
    const mt = (Array.isArray(m.material) ? m.material[0] : m.material).clone() as THREE.MeshStandardMaterial;
    m.material = mt;
    if (!mt.emissive || mt.emissive.getHex() === 0) mt.emissive = mt.color.clone();
    ems.push({ mat: mt, base: mt.emissive.clone(), kind });
    if (kind === 'tail' && !tailGlow) {
      const b = new THREE.Box3().setFromObject(m);
      const c = b.getCenter(new THREE.Vector3());
      const sz = b.getSize(new THREE.Vector3());
      root.worldToLocal(c);
      tailGlow = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(1.6, sz.x * 1.4), 0.5),
        new THREE.MeshBasicMaterial({ map: glowTex, color: new THREE.Color(1.5, 0.05, 0.04), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      tailGlow.position.set(c.x, c.y, b.max.z - root.position.z + 0.03);
      tailGlow.renderOrder = 3;
      root.add(tailGlow);
    }
  });

  const model: CarModel = {
    kind: 'glb',
    root,
    down, rear, rcs,
    setWheels(spin, steer) {
      for (const w of wheels) {
        qS.setFromAxisAngle(AX, -spin * w.sign);
        qP.setFromAxisAngle(AY, w.front ? -steer : 0);
        w.node.quaternion.copy(qP).multiply(w.rest).multiply(qS);
      }
    },
    setLights(brake, boost) {
      for (const e of ems) {
        const f = e.kind === 'tail' ? EMISSIVE_BOOST * (1 + brake * 1.8 + boost * 0.3) : EMISSIVE_BOOST;
        e.mat.emissive.copy(e.base);
        e.mat.emissiveIntensity = f;
      }
      if (tailGlow) (tailGlow.material as THREE.MeshBasicMaterial).color.setRGB(1.5 + brake * 2.4, 0.05 + brake * 0.2, 0.04 + brake * 0.15);
    },
    setNozzleGlow() { /* the GLB has no glow rings: the plume glare sprites carry it */ },
    setUnderGlow() { /* none */ },
    dispose() {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => x.dispose());
        }
      });
      glowTex.dispose();
    },
  };
  model.setLights(0, 0);
  return model;
}

/** Holds whichever model is active. The game positions and rotates `group`; the model sits inside it. */
export class Roadster {
  readonly group = new THREE.Group();
  model: CarModel;

  constructor() {
    this.model = buildProceduralCar();
    this.group.add(this.model.root);
  }

  swap(m: CarModel): CarModel {
    const old = this.model;
    this.group.remove(old.root);
    this.group.add(m.root);
    this.model = m;
    return old;
  }
}

/** Is there a real GLB at this URL? (Vite serves index.html with 200 for missing files, so check the type.) */
export async function glbExists(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    const r = await fetch(url, { method: 'HEAD', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return false;
    const type = r.headers.get('content-type') ?? '';
    if (/text\/html/i.test(type)) return false;
    const len = Number(r.headers.get('content-length') ?? '2000');
    return len > 1000;
  } catch {
    return false;
  }
}
