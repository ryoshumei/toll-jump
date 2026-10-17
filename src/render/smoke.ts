// Cold-gas condensate smoke: ONE instanced draw call, up to ~2500 camera-facing puffs, depth-sorted every frame
// (O(n) radix sort on preallocated typed arrays). Lighting is faked in the shader: dim blue ambient, light from
// the thruster that falls off with distance, a red/pink tint on low smoke near the red edge strips, and a soft
// fade where a puff meets the ground plane.
import * as THREE from 'three';
import { FOG_COLOR, FOG_DENSITY, MOON_DIR } from './environment';
import { makePuffAtlas } from './textures';

// xorshift32, shared by everything that emits
let rs = 2463534242;
export const rnd = (): number => {
  rs ^= rs << 13; rs >>>= 0;
  rs ^= rs >>> 17;
  rs ^= rs << 5; rs >>>= 0;
  return rs / 4294967296;
};
export const rndSigned = (): number => rnd() * 2 - 1;

const STRIDE = 8;
const SORT_FAR = 700;

export interface SmokeLight { x: number; y: number; z: number; intensity: number }

export class SmokeSystem {
  readonly mesh: THREE.Mesh;
  readonly max: number;
  count = 0; // alive particles drawn last frame

  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array; private a0: Float32Array;
  private drag: Float32Array; private buoy: Float32Array; private swirl: Float32Array;
  private rot: Float32Array; private rotV: Float32Array; private seed: Float32Array; private glow: Float32Array;
  private head = 0;

  private ids: Uint16Array; private keys: Uint16Array;
  private posA: Uint16Array; private posB: Uint16Array; private sorted: Uint16Array;
  private counts = new Uint32Array(256);
  private data: Float32Array;
  private geo: THREE.InstancedBufferGeometry;
  private mat: THREE.ShaderMaterial;
  private tmpV = new THREE.Vector3();

  constructor(max: number) {
    this.max = max;
    const f = () => new Float32Array(max);
    this.px = f(); this.py = f(); this.pz = f(); this.vx = f(); this.vy = f(); this.vz = f();
    this.age = f(); this.life = f(); this.s0 = f(); this.s1 = f(); this.a0 = f();
    this.drag = f(); this.buoy = f(); this.swirl = f(); this.rot = f(); this.rotV = f(); this.seed = f(); this.glow = f();
    this.ids = new Uint16Array(max); this.keys = new Uint16Array(max);
    this.posA = new Uint16Array(max); this.posB = new Uint16Array(max); this.sorted = new Uint16Array(max);
    this.data = new Float32Array(max * STRIDE);

    // octagon billboard: wastes less overdraw than a quad
    const verts = [0, 0, 0];
    const R = 1 / Math.cos(Math.PI / 8);
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) * (Math.PI / 4);
      verts.push(Math.cos(a) * R, Math.sin(a) * R, 0);
    }
    const idx: number[] = [];
    for (let k = 0; k < 8; k++) idx.push(0, 1 + k, 1 + ((k + 1) % 8));
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    this.geo.setIndex(idx);
    const ib = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    ib.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('iA', new THREE.InterleavedBufferAttribute(ib, 4, 0));
    this.geo.setAttribute('iB', new THREE.InterleavedBufferAttribute(ib, 4, 4));
    this.geo.instanceCount = 0;

    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uPuff: { value: makePuffAtlas(128) },
        uLightPos: { value: new THREE.Vector3(0, -50, 0) },
        uLightColor: { value: new THREE.Color(0.8, 0.93, 1.0) },
        uLightI: { value: 0 },
        uMoonView: { value: new THREE.Vector3(0, 1, 0) },
        uEdgeViewR: { value: new THREE.Vector3(1, 0, 0) },
        uHW0: { value: 10.5 }, uHWSlope: { value: 0 }, uZ0: { value: 0 },
        uFogColor: { value: new THREE.Color(FOG_COLOR) },
        uFogDensity: { value: FOG_DENSITY },
      },
      vertexShader: `
        attribute vec4 iA; attribute vec4 iB;
        uniform vec3 uLightPos;
        varying vec2 vUv; varying float vAlpha; varying float vRot; varying float vSeed; varying float vGlow;
        varying vec3 vWorld; varying float vWorldY; varying vec3 vLightVec; varying float vViewDist;
        void main() {
          vec3 center = iA.xyz;
          vec4 cmv = viewMatrix * vec4(center, 1.0);
          float c = cos(iB.x), s = sin(iB.x);
          vec2 q = position.xy;
          vec2 off = vec2(q.x * c - q.y * s, q.x * s + q.y * c) * iA.w;
          vec3 wo = vec3(off, 0.0) * mat3(viewMatrix);
          vWorldY = center.y + wo.y;
          vWorld = center;
          vec4 mv = cmv; mv.xy += off;
          gl_Position = projectionMatrix * mv;
          vUv = q * 0.5 + 0.5;
          vAlpha = iB.y; vRot = iB.x; vSeed = iB.z; vGlow = iB.w;
          vLightVec = (viewMatrix * vec4(uLightPos, 1.0)).xyz - cmv.xyz;
          vViewDist = length(cmv.xyz);
        }`,
      fragmentShader: `
        uniform sampler2D uPuff; uniform vec3 uLightColor; uniform float uLightI;
        uniform vec3 uMoonView; uniform vec3 uEdgeViewR; uniform float uHW0; uniform float uHWSlope; uniform float uZ0;
        uniform vec3 uFogColor; uniform float uFogDensity;
        varying vec2 vUv; varying float vAlpha; varying float vRot; varying float vSeed; varying float vGlow;
        varying vec3 vWorld; varying float vWorldY; varying vec3 vLightVec; varying float vViewDist;
        void main() {
          float variant = floor(vSeed * 4.0);
          vec2 cell = vec2(mod(variant, 2.0), floor(variant * 0.5));
          vec4 puff = texture2D(uPuff, (cell + clamp(vUv, 0.0, 1.0)) * 0.5);
          float a = puff.a * vAlpha;
          a *= smoothstep(2.2, 7.5, vViewDist);
          a *= smoothstep(-0.02, 0.5, vWorldY);
          if (a < 0.004) discard;
          float cr = cos(vRot), sr = sin(vRot);
          vec2 tn = puff.rg * 2.0 - 1.0;
          vec2 p = (vUv - 0.5) * 2.0;
          vec2 tnr = vec2(tn.x * cr - tn.y * sr, tn.x * sr + tn.y * cr);
          vec2 pr = vec2(p.x * cr - p.y * sr, p.x * sr + p.y * cr);
          vec3 ns = vec3(pr * 0.85, sqrt(max(0.04, 1.0 - dot(pr, pr) * 0.72)));
          vec3 nt = vec3(tnr * 1.4, 1.0);
          vec3 n = normalize(mix(ns, nt, 0.5));
          vec3 L = normalize(vLightVec);
          float dist = length(vLightVec);
          float att = uLightI / (1.0 + dist * dist * 0.011);
          float hl = dot(n, L) * 0.5 + 0.5;
          vec3 col = vec3(0.11, 0.145, 0.235) * (0.6 + 0.4 * n.y);
          col += uLightColor * (hl * hl) * att;
          col += vec3(0.11, 0.15, 0.24) * max(dot(n, uMoonView), 0.0);
          float edge = abs(abs(vWorld.x) - (uHW0 + uHWSlope * (vWorld.z - uZ0)));
          float red = exp(-edge * 0.2) * smoothstep(5.5, 0.4, vWorld.y);
          vec3 toEdge = uEdgeViewR * (vWorld.x < 0.0 ? -1.0 : 1.0);
          col += vec3(1.0, 0.15, 0.2) * red * (0.3 + 0.7 * max(dot(n, toEdge), 0.0)) * 0.95;
          col += vec3(0.42, 0.74, 1.0) * vGlow;
          col *= vec3(0.93, 0.985, 1.0) * (0.62 + 0.38 * puff.b);
          float fog = 1.0 - exp(-pow(uFogDensity * vViewDist, 2.0));
          col = mix(col, uFogColor, fog);
          gl_FragColor = vec4(col, a);
        }`,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
  }

  /** Emit one puff. Sizes are radii in metres. */
  spawn(
    x: number, y: number, z: number, vx: number, vy: number, vz: number,
    s0: number, s1: number, life: number, alpha: number, drag: number, buoy: number, swirl: number, glow = 0,
  ): void {
    const i = this.head;
    this.head = (i + 1) % this.max;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.s0[i] = s0; this.s1[i] = s1; this.life[i] = life; this.age[i] = 0; this.a0[i] = alpha;
    this.drag[i] = drag; this.buoy[i] = buoy; this.swirl[i] = swirl;
    this.rot[i] = rnd() * 6.2832; this.rotV[i] = rndSigned() * 0.35;
    this.seed[i] = rnd() * 0.999; this.glow[i] = glow;
  }

  clear(): void {
    this.life.fill(0);
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  update(dt: number, camera: THREE.Camera, light: SmokeLight, hw0: number, hwSlope: number, z0: number): void {
    const { px, py, pz, vx, vy, vz, age, life, s0, s1, a0, drag, buoy, swirl, rot, rotV } = this;
    const n = this.max;
    let alive = 0;
    for (let i = 0; i < n; i++) {
      const l = life[i];
      if (l <= 0) continue;
      const a = age[i] + dt;
      if (a >= l) { life[i] = 0; continue; }
      age[i] = a;
      const k = Math.exp(-drag[i] * dt);
      let ux = vx[i] * k, uz = vz[i] * k;
      const sw = swirl[i] * dt;
      if (sw !== 0) { const c = Math.cos(sw), s = Math.sin(sw); const tx = ux * c - uz * s; uz = ux * s + uz * c; ux = tx; }
      vx[i] = ux; vz[i] = uz;
      vy[i] = vy[i] * k + buoy[i] * dt;
      px[i] += ux * dt; py[i] += vy[i] * dt; pz[i] += uz * dt;
      if (py[i] < 0.04) { py[i] = 0.04; if (vy[i] < 0) vy[i] = 0; }
      rot[i] += rotV[i] * dt;
      this.ids[alive++] = i;
    }
    this.count = alive;
    this.geo.instanceCount = alive;

    // view-space depth keys (far first for correct back-to-front blending)
    const m = camera.matrixWorldInverse.elements;
    const keys = this.keys;
    for (let j = 0; j < alive; j++) {
      const i = this.ids[j];
      const d = -(m[2] * px[i] + m[6] * py[i] + m[10] * pz[i] + m[14]);
      const q = d <= 0 ? 0 : d >= SORT_FAR ? 65535 : (d / SORT_FAR) * 65535;
      keys[j] = 65535 - (q | 0);
    }
    this.radix(alive);

    const data = this.data;
    for (let j = 0; j < alive; j++) {
      const i = this.sorted[j];
      const t = age[i] / life[i];
      const grow = 1 - (1 - t) * (1 - t);
      const o = j * STRIDE;
      data[o] = px[i]; data[o + 1] = py[i]; data[o + 2] = pz[i];
      data[o + 3] = s0[i] + (s1[i] - s0[i]) * grow;
      data[o + 4] = rot[i];
      const fadeIn = t < 0.07 ? t / 0.07 : 1;
      const fo = t < 0.45 ? 1 : 1 - (t - 0.45) / 0.55;
      data[o + 5] = a0[i] * fadeIn * fo * fo;
      data[o + 6] = this.seed[i];
      data[o + 7] = this.glow[i] * Math.max(0, 1 - t * 4);
    }
    (this.geo.attributes.iA as THREE.InterleavedBufferAttribute).data.needsUpdate = true;

    // shader uniforms
    const u = this.mat.uniforms;
    (u.uLightPos.value as THREE.Vector3).set(light.x, light.y, light.z);
    u.uLightI.value = light.intensity;
    (u.uMoonView.value as THREE.Vector3).copy(MOON_DIR).transformDirection(camera.matrixWorldInverse);
    (u.uEdgeViewR.value as THREE.Vector3).set(1, 0, 0).transformDirection(camera.matrixWorldInverse);
    u.uHW0.value = hw0; u.uHWSlope.value = hwSlope; u.uZ0.value = z0;
  }

  /** Two-pass LSD radix sort (16-bit keys, ascending) of the alive ids into `sorted`. No allocation. */
  private radix(n: number): void {
    const { ids, keys, counts, posA, posB, sorted } = this;
    counts.fill(0);
    for (let j = 0; j < n; j++) counts[keys[j] & 255]++;
    let sum = 0;
    for (let b = 0; b < 256; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
    for (let j = 0; j < n; j++) posA[counts[keys[j] & 255]++] = j;
    counts.fill(0);
    for (let j = 0; j < n; j++) counts[keys[j] >> 8]++;
    sum = 0;
    for (let b = 0; b < 256; b++) { const c = counts[b]; counts[b] = sum; sum += c; }
    for (let j = 0; j < n; j++) { const p = posA[j]; posB[counts[keys[p] >> 8]++] = p; }
    for (let j = 0; j < n; j++) sorted[j] = ids[posB[j]];
  }
}
