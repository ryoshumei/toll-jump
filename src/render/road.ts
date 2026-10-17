// Endless night highway: a pool of recycled chunks (road, barriers, red LED strips, glow, lane markings),
// instanced street lamps with additive light pools and wet-road streaks, and a dark ground plane.
// Nothing is created or destroyed after construction: chunks are rewritten in place.
import * as THREE from 'three';
import { shared } from './environment';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ROAD } from '../config';
import { exitGap, laneLineAlpha, laneLineX, roadHalfWidth } from '../sim/course';
import { makeAsphalt, makeConcrete, makeGlowTexture, makeGround, makePoolTexture } from './textures';

const CL = ROAD.chunkLen; // 120 m
const ROW = ROAD.rowLen; // 10 m
const ROWS = CL / ROW; // 12
const POOL = 6; // chunks alive: 1 behind, the one we are on, 4 ahead (>= 480 m)
const LAMPS_PER_SIDE = 3; // every 40 m
const LAMPS_PER_CHUNK = LAMPS_PER_SIDE * 2;
const LAMP_SPACING = CL / LAMPS_PER_SIDE;
const MAX_QUADS = 24 + 7 * 14 + 8;

const mod = (a: number, n: number) => ((a % n) + n) % n;

// Barrier profile (outward distance from the road edge, height), inner face first.
const PROFILE: [number, number][] = [[0, 0], [0, 0.17], [0.13, 0.45], [0.22, 0.86], [0.5, 0.86]];
const PNORM: [number, number][] = (() => {
  const seg: [number, number][] = [];
  for (let i = 0; i < PROFILE.length - 1; i++) {
    const dx = PROFILE[i + 1][0] - PROFILE[i][0];
    const dy = PROFILE[i + 1][1] - PROFILE[i][1];
    const l = Math.hypot(dx, dy);
    seg.push([-dy / l, dx / l]); // points toward the road and up
  }
  const out: [number, number][] = [];
  for (let i = 0; i < PROFILE.length; i++) {
    const a = seg[Math.max(0, i - 1)];
    const b = seg[Math.min(seg.length - 1, i)];
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const l = Math.hypot(x, y);
    out.push([x / l, y / l]);
  }
  return out;
})();

function dynGeo(maxVerts: number, maxIdx: number, withNormal: boolean, withUv: boolean, withUv1: boolean, withColor: boolean): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const mk = (n: number, c: number) => {
    const a = new THREE.BufferAttribute(new Float32Array(maxVerts * n), n);
    a.setUsage(THREE.DynamicDrawUsage);
    return a;
  };
  g.setAttribute('position', mk(3, 3));
  if (withNormal) g.setAttribute('normal', mk(3, 3));
  if (withUv) g.setAttribute('uv', mk(2, 2));
  if (withUv1) g.setAttribute('uv1', mk(2, 2));
  if (withColor) g.setAttribute('color', mk(3, 3));
  const idx = new Uint16Array(maxIdx);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, -CL / 2), CL * 0.9);
  return g;
}

const arr = (g: THREE.BufferGeometry, n: string) => (g.getAttribute(n) as THREE.BufferAttribute).array as Float32Array;
const touch = (g: THREE.BufferGeometry) => {
  for (const k of Object.keys(g.attributes)) (g.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
};

interface Chunk {
  n: number;
  road: THREE.Mesh;
  rails: THREE.Mesh;
  strip: THREE.Mesh;
  glow: THREE.Mesh;
  marks: THREE.Mesh;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

export class Road {
  readonly group = new THREE.Group();
  private chunks: Chunk[] = [];
  private curN = -999999;
  private poles: THREE.InstancedMesh;
  private heads: THREE.InstancedMesh;
  private pools: THREE.InstancedMesh;
  private streaks: THREE.InstancedMesh;
  private ground: THREE.Mesh;
  readonly roadMat: THREE.MeshStandardMaterial;

  constructor() {
    const { albedo, rough } = makeAsphalt(512);
    rough.channel = 1; // roughness map uses its own (larger) uv set
    const concrete = makeConcrete(256);
    this.roadMat = new THREE.MeshStandardMaterial({ map: albedo, roughnessMap: rough, roughness: 1, metalness: 0, envMap: shared.env, envMapIntensity: 0.07, side: THREE.DoubleSide });
    const railMat = new THREE.MeshStandardMaterial({ map: concrete, color: 0x9a9fa8, roughness: 0.85, metalness: 0, envMap: shared.env, envMapIntensity: 0.05, side: THREE.DoubleSide });
    const stripMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.06, 0.04), side: THREE.DoubleSide });
    const glowMat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const marksMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, vertexColors: true, roughness: 0.4, metalness: 0, emissive: 0x2a2b30, envMap: shared.env, envMapIntensity: 0.06,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide,
    });

    // static index buffers
    for (let i = 0; i < POOL; i++) {
      const roadG = dynGeo((ROWS + 1) * 2, ROWS * 6, true, true, true, false);
      const railsG = dynGeo(2 * (ROWS + 1) * PROFILE.length, 2 * ROWS * (PROFILE.length - 1) * 6, true, true, false, false);
      const stripG = dynGeo(2 * (ROWS + 1) * 2, 2 * ROWS * 6, false, false, false, false);
      const glowG = dynGeo(2 * (ROWS + 1) * 2, 2 * ROWS * 6, false, false, false, true);
      const marksG = dynGeo(MAX_QUADS * 4, MAX_QUADS * 6, true, false, false, true);
      // road & glow & strip indices: ribbons of 2 verts per row
      const ribbon = (g: THREE.BufferGeometry, sides: number) => {
        const ix = g.getIndex()!.array as Uint16Array;
        let k = 0;
        for (let s = 0; s < sides; s++) {
          for (let r = 0; r < ROWS; r++) {
            const a = (s * (ROWS + 1) + r) * 2;
            ix[k++] = a; ix[k++] = a + 2; ix[k++] = a + 1;
            ix[k++] = a + 1; ix[k++] = a + 2; ix[k++] = a + 3;
          }
        }
      };
      ribbon(roadG, 1);
      ribbon(stripG, 2);
      ribbon(glowG, 2);
      {
        const ix = railsG.getIndex()!.array as Uint16Array;
        let k = 0;
        const P = PROFILE.length;
        for (let s = 0; s < 2; s++) {
          for (let r = 0; r < ROWS; r++) {
            for (let p = 0; p < P - 1; p++) {
              const a = (s * (ROWS + 1) + r) * P + p;
              const b = a + 1;
              const c = a + P;
              const d = c + 1;
              ix[k++] = a; ix[k++] = c; ix[k++] = b;
              ix[k++] = b; ix[k++] = c; ix[k++] = d;
            }
          }
        }
      }
      {
        const ix = marksG.getIndex()!.array as Uint16Array;
        for (let q = 0; q < MAX_QUADS; q++) {
          const a = q * 4;
          const k = q * 6;
          ix[k] = a; ix[k + 1] = a + 2; ix[k + 2] = a + 1;
          ix[k + 3] = a + 1; ix[k + 4] = a + 2; ix[k + 5] = a + 3;
        }
      }
      const road = new THREE.Mesh(roadG, this.roadMat);
      road.receiveShadow = true;
      const rails = new THREE.Mesh(railsG, railMat);
      const strip = new THREE.Mesh(stripG, stripMat);
      const glow = new THREE.Mesh(glowG, glowMat);
      glow.renderOrder = 2;
      const marks = new THREE.Mesh(marksG, marksMat);
      marks.receiveShadow = true;
      for (const m of [road, rails, strip, glow, marks]) {
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.chunks.push({ n: -999999, road, rails, strip, glow, marks });
    }

    // lamps
    const pole = new THREE.CylinderGeometry(0.1, 0.17, 9.2, 8);
    pole.translate(0, 4.6, 0);
    const arm = new THREE.BoxGeometry(2.7, 0.13, 0.13);
    arm.translate(-1.35, 9.1, 0);
    const poleGeo = mergeGeometries([pole.toNonIndexed(), arm.toNonIndexed()])!;
    const headGeo = new THREE.BoxGeometry(0.95, 0.09, 0.34);
    const N = POOL * LAMPS_PER_CHUNK;
    this.poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x3a3e46, roughness: 0.6, metalness: 0.7, envMap: shared.env, envMapIntensity: 0.4 }), N);
    this.heads = new THREE.InstancedMesh(headGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 3.4, 4.2) }), N);
    const poolTex = makePoolTexture(128);
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.pools = new THREE.InstancedMesh(
      flat,
      new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(0.5, 0.63, 0.92), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      N,
    );
    const streakTex = makeGlowTexture(64, 1.6);
    this.streaks = new THREE.InstancedMesh(
      flat,
      new THREE.MeshBasicMaterial({ map: streakTex, color: new THREE.Color(0.55, 0.68, 1.0), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      N,
    );
    this.pools.renderOrder = 1;
    this.streaks.renderOrder = 1;
    for (const m of [this.poles, this.heads, this.pools, this.streaks]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }

    // ground
    const gt = makeGround(256);
    gt.repeat.set(120, 120);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1440, 1440),
      new THREE.MeshLambertMaterial({ map: gt, color: 0x181b18 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.05;
    this.ground.frustumCulled = false;
    this.group.add(this.ground);
  }

  /** Recycle chunks around the car. At most one chunk per frame when driving; all of them after a teleport. */
  update(carZ: number): void {
    const n = Math.floor(-carZ / CL);
    this.ground.position.z = Math.round(carZ / 36) * 36;
    if (n === this.curN) return;
    this.curN = n;
    for (let w = n - 1; w <= n + POOL - 2; w++) {
      const slot = mod(w, POOL);
      if (this.chunks[slot].n !== w) this.build(slot, w);
    }
    for (const m of [this.poles, this.heads, this.pools, this.streaks]) m.instanceMatrix.needsUpdate = true;
  }

  private build(slot: number, n: number): void {
    const c = this.chunks[slot];
    c.n = n;
    const z0 = -n * CL;
    for (const m of [c.road, c.rails, c.strip, c.glow, c.marks]) m.position.set(0, 0, z0);

    // --- road ribbon ---
    {
      const g = c.road.geometry;
      const P = arr(g, 'position'); const N = arr(g, 'normal'); const U = arr(g, 'uv'); const U1 = arr(g, 'uv1');
      for (let r = 0; r <= ROWS; r++) {
        const zl = -r * ROW;
        const hw = roadHalfWidth(z0 + zl);
        for (let s = 0; s < 2; s++) {
          const i = r * 2 + s;
          const x = s === 0 ? -hw : hw;
          P[i * 3] = x; P[i * 3 + 1] = 0; P[i * 3 + 2] = zl;
          N[i * 3] = 0; N[i * 3 + 1] = 1; N[i * 3 + 2] = 0;
          U[i * 2] = x / 6; U[i * 2 + 1] = -zl / 6;
          U1[i * 2] = x / 30 + 0.37; U1[i * 2 + 1] = (z0 + zl) / -30;
        }
      }
      touch(g);
    }

    // --- barriers, LED strips, glow ---
    {
      const g = c.rails.geometry;
      const P = arr(g, 'position'); const N = arr(g, 'normal'); const U = arr(g, 'uv');
      const sg = c.strip.geometry; const SP = arr(sg, 'position');
      const gg = c.glow.geometry; const GP = arr(gg, 'position'); const GC = arr(gg, 'color');
      const PL = PROFILE.length;
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? -1 : 1;
        for (let r = 0; r <= ROWS; r++) {
          const zl = -r * ROW;
          const hw = roadHalfWidth(z0 + zl);
          const gf = s === 1 && exitGap(z0 + zl) ? 0 : 1; // the right barrier opens where the arena exit ramp leaves
          for (let p = 0; p < PL; p++) {
            const i = (s * (ROWS + 1) + r) * PL + p;
            P[i * 3] = sign * (hw + PROFILE[p][0] * gf); P[i * 3 + 1] = PROFILE[p][1] * gf; P[i * 3 + 2] = zl;
            N[i * 3] = sign * PNORM[p][0]; N[i * 3 + 1] = PNORM[p][1]; N[i * 3 + 2] = 0;
            U[i * 2] = -zl / 5; U[i * 2 + 1] = p * 0.22;
          }
          // red LED strip on the inner face, a hair toward the road
          const si = (s * (ROWS + 1) + r) * 2;
          SP[si * 3] = sign * (hw - 0.012); SP[si * 3 + 1] = 0.045 * gf; SP[si * 3 + 2] = zl;
          SP[(si + 1) * 3] = sign * (hw - 0.012); SP[(si + 1) * 3 + 1] = 0.115 * gf; SP[(si + 1) * 3 + 2] = zl;
          // additive glow on the road beside it: hot at the barrier, gone 3.4 m out
          const gi = (s * (ROWS + 1) + r) * 2;
          GP[gi * 3] = sign * (hw - 0.02); GP[gi * 3 + 1] = 0.014; GP[gi * 3 + 2] = zl;
          GC[gi * 3] = 0.34 * gf; GC[gi * 3 + 1] = 0.02 * gf; GC[gi * 3 + 2] = 0.014 * gf;
          GP[(gi + 1) * 3] = sign * (hw - 2.8); GP[(gi + 1) * 3 + 1] = 0.014; GP[(gi + 1) * 3 + 2] = zl;
          GC[(gi + 1) * 3] = 0; GC[(gi + 1) * 3 + 1] = 0; GC[(gi + 1) * 3 + 2] = 0;
        }
      }
      touch(g); touch(sg); touch(gg);
    }

    // --- lane markings: solid edge lines and dashes that fan out over the plaza taper ---
    {
      const g = c.marks.geometry;
      const P = arr(g, 'position'); const N = arr(g, 'normal'); const C = arr(g, 'color');
      let q = 0;
      const quad = (xa0: number, xa1: number, za: number, xb0: number, xb1: number, zb: number, bright: number) => {
        if (q >= MAX_QUADS) return;
        const i = q * 4;
        const set = (k: number, x: number, z: number) => {
          P[(i + k) * 3] = x; P[(i + k) * 3 + 1] = 0.005; P[(i + k) * 3 + 2] = z;
          N[(i + k) * 3] = 0; N[(i + k) * 3 + 1] = 1; N[(i + k) * 3 + 2] = 0;
          C[(i + k) * 3] = bright; C[(i + k) * 3 + 1] = bright; C[(i + k) * 3 + 2] = bright * 0.97;
        };
        set(0, xa0, za); set(1, xa1, za); set(2, xb0, zb); set(3, xb1, zb);
        q++;
      };
      for (const k of [-3, 3]) {
        for (let r = 0; r < ROWS; r++) {
          const za = -r * ROW; const zb = -(r + 1) * ROW;
          const xa = laneLineX(k, z0 + za); const xb = laneLineX(k, z0 + zb);
          quad(xa - 0.1, xa + 0.1, za, xb - 0.1, xb + 0.1, zb, 0.85);
        }
      }
      for (let k = -2; k <= 2; k++) {
        for (let m = 0; m < 14; m++) {
          const za = -m * 9 - 2;
          const zb = za - 3;
          if (zb < -CL) break;
          const al = laneLineAlpha(k, z0 + za);
          if (al < 0.03) continue;
          const xa = laneLineX(k, z0 + za); const xb = laneLineX(k, z0 + zb);
          quad(xa - 0.1, xa + 0.1, za, xb - 0.1, xb + 0.1, zb, 1.0 * al);
        }
      }
      // collapse unused quads (the draw range hides them anyway)
      g.setDrawRange(0, q * 6);
      touch(g);
    }

    // --- lamps: both sides, every 40 m ---
    {
      let li = slot * LAMPS_PER_CHUNK;
      for (let m = 0; m < LAMPS_PER_SIDE; m++) {
        const zl = -(20 + m * LAMP_SPACING);
        const zw = z0 + zl;
        const hw = roadHalfWidth(zw);
        for (const sign of [-1, 1]) {
          const px = sign * (hw + 0.95);
          _qy.setFromAxisAngle(Y, sign > 0 ? 0 : Math.PI);
          _p.set(px, 0, zw);
          _m.compose(_p, _qy, _s.set(1, 1, 1));
          this.poles.setMatrixAt(li, _m);
          const hx = px - sign * 2.65;
          _p.set(hx, 8.98, zw);
          _m.compose(_p, _q.identity(), _s.set(1, 1, 1));
          this.heads.setMatrixAt(li, _m);
          _p.set(hx - sign * 2.4, 0.02, zw);
          _m.compose(_p, _q.identity(), _s.set(11, 1, 18));
          this.pools.setMatrixAt(li, _m);
          _p.set(hx, 0.024, zw + 11);
          _m.compose(_p, _q.identity(), _s.set(1.5, 1, 26));
          this.streaks.setMatrixAt(li, _m);
          li++;
        }
      }
    }
  }
}

void _qx;
