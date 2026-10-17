// Pooled traffic: low-poly sedans and Tesla Semi trucks, driving slower than the player in their lanes.
// Instanced meshes with fixed counts; vehicles are recycled ahead of the player, never created or destroyed.
import * as THREE from 'three';
import { shared } from './environment';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROAD, TRAFFIC } from '../config';
import { type Box, setBox } from '../sim/collision';
import { pickLane, trafficKeepOut } from '../sim/course';
import { makeGlowTexture } from './textures';
import { rnd } from './smoke';

const LANES = [-5.625, -1.875, 1.875, 5.625];
const PALETTE = [0xe8eaee, 0xc9ccd2, 0x2a2d33, 0x14161a, 0x7b1d22, 0x1c3a5c, 0x8f949c, 0xd8d2c4].map((h) => new THREE.Color(h));
const N_SEDAN = TRAFFIC.sedans;
const N_SEMI = TRAFFIC.semis;

const setColors = (g: THREE.BufferGeometry, r: number, gr: number, b: number) => {
  const n = g.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = r; c[i * 3 + 1] = gr; c[i * 3 + 2] = b; }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
};
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

function wheelGeo(x: number, y: number, z: number, r: number, w: number): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, 14);
  g.rotateZ(Math.PI / 2);
  g.translate(x, y, z);
  return setColors(ni(g), 0.03, 0.03, 0.035);
}

/** Side profile (z, y) extruded across the width, with a small bevel. The car faces -Z. */
function profileBody(pts: [number, number][], halfW: number, bevel: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  pts.forEach((p, i) => (i === 0 ? s.moveTo(p[0], p[1]) : s.lineTo(p[0], p[1])));
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: halfW * 2 - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1 });
  g.translate(0, 0, -(halfW - bevel)); // centre across the width (extrusion axis)
  g.rotateY(Math.PI / 2); // profile x -> world -z (nose toward -Z), extrusion axis -> world x
  return g;
}

function buildSedan(): { body: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  // profile points are (forward distance along -z as +x, height): nose at +x
  const prof: [number, number][] = [
    [2.25, 0.3], [2.25, 0.74], [1.1, 0.88], [0.45, 1.34], [-0.95, 1.38], [-1.65, 0.92], [-2.25, 0.88], [-2.25, 0.3],
  ];
  const body = setColors(ni(profileBody(prof, 0.9, 0.05)), 1, 1, 1);
  const parts: THREE.BufferGeometry[] = [body];
  for (const sx of [-1, 1]) for (const sz of [-1.45, 1.45]) parts.push(wheelGeo(sx * 0.86, 0.32, sz, 0.32, 0.22));
  // dark glass band
  const glass = setColors(ni(new RoundedBoxGeometry(1.86, 0.34, 1.9, 1, 0.04)), 0.02, 0.025, 0.03);
  glass.translate(0, 1.12, 0.05);
  parts.push(glass);
  const lightParts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    const t = setColors(ni(new RoundedBoxGeometry(0.46, 0.11, 0.06, 1, 0.02)), 3.6, 0.1, 0.08);
    t.translate(sx * 0.62, 0.82, 2.27);
    lightParts.push(t);
    const h = setColors(ni(new RoundedBoxGeometry(0.4, 0.09, 0.06, 1, 0.02)), 4.4, 4.6, 5.4);
    h.translate(sx * 0.62, 0.7, -2.27);
    lightParts.push(h);
  }
  return { body: mergeGeometries(parts.map(ni))!, lights: mergeGeometries(lightParts.map(ni))! };
}

function buildSemi(): { body: THREE.BufferGeometry; lights: THREE.BufferGeometry } {
  const cabProf: [number, number][] = [
    [8.0, 0.5], [8.0, 1.5], [7.65, 2.45], [6.5, 3.2], [4.9, 3.3], [4.5, 3.3], [4.5, 0.6],
  ];
  const cab = setColors(ni(profileBody(cabProf, 1.25, 0.09)), 0.96, 0.97, 1.0);
  const trailer = setColors(ni(new RoundedBoxGeometry(2.6, 3.3, 12.2, 1, 0.1)), 0.9, 0.91, 0.94);
  trailer.translate(0, 2.35, 1.9);
  const chassis = setColors(ni(new RoundedBoxGeometry(2.3, 0.4, 15.4, 1, 0.05)), 0.05, 0.05, 0.06);
  chassis.translate(0, 0.62, 0);
  const wind = setColors(ni(new RoundedBoxGeometry(2.3, 0.85, 1.3, 1, 0.08)), 0.015, 0.02, 0.025);
  wind.translate(0, 2.35, -6.35);
  wind.rotateX(0);
  const skirt = setColors(ni(new RoundedBoxGeometry(2.62, 0.5, 12.2, 1, 0.05)), 0.12, 0.12, 0.14);
  skirt.translate(0, 0.9, 1.9);
  const parts: THREE.BufferGeometry[] = [cab, trailer, chassis, wind, skirt];
  for (const sx of [-1, 1]) for (const z of [-5.3, -3.9, 4.8, 6.1, 7.4]) parts.push(wheelGeo(sx * 1.12, 0.5, z, 0.5, 0.34));
  const lightParts: THREE.BufferGeometry[] = [];
  for (let i = -2; i <= 2; i++) {
    const a = setColors(ni(new RoundedBoxGeometry(0.22, 0.1, 0.1, 1, 0.03)), 4.0, 1.7, 0.1);
    a.translate(i * 0.42, 3.38, -5.8);
    lightParts.push(a);
  }
  for (const sx of [-1, 1]) {
    const h = setColors(ni(new RoundedBoxGeometry(0.55, 0.12, 0.08, 1, 0.03)), 4.6, 4.8, 5.6);
    h.translate(sx * 0.82, 1.0, -8.02);
    lightParts.push(h);
    const t = setColors(ni(new RoundedBoxGeometry(0.5, 0.2, 0.06, 1, 0.03)), 3.8, 0.1, 0.08);
    t.translate(sx * 0.95, 1.05, 8.03);
    lightParts.push(t);
  }
  return { body: mergeGeometries(parts.map(ni))!, lights: mergeGeometries(lightParts.map(ni))! };
}

export class Traffic {
  readonly group = new THREE.Group();
  readonly n = N_SEDAN + N_SEMI;
  readonly x = new Float32Array(N_SEDAN + N_SEMI);
  readonly z = new Float32Array(N_SEDAN + N_SEMI);
  readonly v = new Float32Array(N_SEDAN + N_SEMI); // forward speed (m/s)
  /** Set by the game once a near miss has been awarded for a slot; cleared when it is recycled. */
  readonly nearMissed = new Uint8Array(N_SEDAN + N_SEMI);
  private sedanBody: THREE.InstancedMesh;
  private sedanLights: THREE.InstancedMesh;
  private semiBody: THREE.InstancedMesh;
  private semiLights: THREE.InstancedMesh;
  private semiTimer = 14; // Semis are rare: a long wait before one shows up
  private streaks: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor() {
    const sed = buildSedan();
    const semi = buildSemi();
    const bodyMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.42, envMap: shared.env, envMapIntensity: 0.35 });
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this.sedanBody = new THREE.InstancedMesh(sed.body, bodyMat, N_SEDAN);
    this.sedanLights = new THREE.InstancedMesh(sed.lights, lightMat, N_SEDAN);
    this.semiBody = new THREE.InstancedMesh(semi.body, bodyMat, N_SEMI);
    this.semiLights = new THREE.InstancedMesh(semi.lights, lightMat, N_SEMI);
    for (let i = 0; i < N_SEDAN; i++) this.sedanBody.setColorAt(i, PALETTE[i % PALETTE.length]);
    for (let i = 0; i < N_SEMI; i++) this.semiBody.setColorAt(i, new THREE.Color(1, 1, 1));
    this.sedanBody.castShadow = true;
    this.semiBody.castShadow = true;
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    this.streaks = new THREE.InstancedMesh(
      flat,
      new THREE.MeshBasicMaterial({ map: makeGlowTexture(64, 1.7), color: new THREE.Color(0.7, 0.05, 0.04), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      this.n,
    );
    this.streaks.renderOrder = 1;
    for (const m of [this.sedanBody, this.sedanLights, this.semiBody, this.semiLights, this.streaks]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      this.group.add(m);
    }
    this.reset(0);
  }

  isSemi(i: number): boolean { return i >= N_SEDAN; }

  /** Bit i set: lane i has a vehicle near z (other than slot `self`). */
  private laneMask(z: number, self: number): number {
    let mask = 0;
    for (let j = 0; j < this.n; j++) {
      if (j === self || Math.abs(this.z[j] - z) > 70) continue;
      const x = this.x[j];
      mask |= 1 << (x < -3.75 ? 0 : x < 0 ? 1 : x < 3.75 ? 2 : 3);
    }
    return mask;
  }

  private park(i: number, pz: number): void {
    this.x[i] = LANES[Math.floor(rnd() * 4)];
    this.z[i] = pz + 100000; // out of the way until a later frame finds room
    this.v[i] = 0;
    this.nearMissed[i] = 0;
  }

  private respawn(i: number, pz: number, minAhead: number): void {
    const semi = i >= N_SEDAN;
    if (semi && this.semiTimer > 0) { this.park(i, pz); return; }
    for (let tries = 0; tries < 8; tries++) {
      const z = pz - (minAhead + rnd() * (TRAFFIC.ahead - minAhead));
      if (trafficKeepOut(z)) continue; // no traffic before a toll plaza or the arena exit
      const lane = pickLane(this.laneMask(z, i), rnd()); // and always at least one lane clear
      if (lane < 0) continue;
      this.x[i] = LANES[lane];
      this.z[i] = z;
      this.v[i] = semi ? TRAFFIC.semiSpeed * (0.85 + rnd() * 0.3) : TRAFFIC.minSpeed + rnd() * (TRAFFIC.maxSpeed - TRAFFIC.minSpeed);
      this.nearMissed[i] = 0;
      return;
    }
    this.park(i, pz);
  }

  /** Place the whole pool around z (start of a run, or after a teleport). */
  reset(pz: number): void {
    this.semiTimer = 14;
    for (let i = 0; i < this.n; i++) { this.z[i] = pz + 1e5; this.x[i] = 0; }
    for (let i = 0; i < this.n; i++) this.respawn(i, pz, i >= N_SEDAN ? 220 : 90);
    this.writeMatrices();
  }

  update(dt: number, pz: number): void {
    if (this.semiTimer > 0) this.semiTimer -= dt;
    for (let i = 0; i < this.n; i++) {
      this.z[i] -= this.v[i] * dt;
      const parked = this.z[i] > pz + 5000;
      const behind = this.z[i] > pz + TRAFFIC.behind && !parked;
      const tooFar = this.z[i] < pz - TRAFFIC.ahead - 60;
      const entering = !parked && this.z[i] < pz - 70 && trafficKeepOut(this.z[i]); // drove into a keep-out zone ahead
      if (behind || tooFar || entering) {
        if (i >= N_SEDAN) this.semiTimer = 30 + rnd() * 30;
        this.respawn(i, pz, i >= N_SEDAN ? 260 : 200);
      } else if (parked) {
        this.respawn(i, pz, i >= N_SEDAN ? 260 : 200);
      }
    }
    this.writeMatrices();
  }

  private writeMatrices(): void {
    const m = this.m;
    this.q.identity();
    for (let i = 0; i < this.n; i++) {
      const semi = i >= N_SEDAN;
      m.compose(this.p.set(this.x[i], 0, this.z[i]), this.q, this.s.set(1, 1, 1));
      if (semi) {
        this.semiBody.setMatrixAt(i - N_SEDAN, m);
        this.semiLights.setMatrixAt(i - N_SEDAN, m);
      } else {
        this.sedanBody.setMatrixAt(i, m);
        this.sedanLights.setMatrixAt(i, m);
      }
      const len = semi ? 16 : 4.5;
      m.compose(this.p.set(this.x[i], 0.02, this.z[i] + len / 2 + 5), this.q, this.s.set(semi ? 2.2 : 1.7, 1, 11 + (semi ? 4 : 0)));
      this.streaks.setMatrixAt(i, m);
    }
    for (const mm of [this.sedanBody, this.sedanLights, this.semiBody, this.semiLights, this.streaks]) mm.instanceMatrix.needsUpdate = true;
  }

  /** Axis-aligned box of slot i, for collisions. */
  box(i: number, out: Box): Box {
    const d = i >= N_SEDAN ? TRAFFIC.semi : TRAFFIC.sedan;
    return setBox(out, this.x[i], d.hy, this.z[i], d.hx, d.hy, d.hz);
  }
}

void ROAD;
