// Pooled sparks and debris (crashes, snapped toll booms). One InstancedMesh, no allocation after construction.
import * as THREE from 'three';
import { rnd, rndSigned } from './smoke';

const MAX = 128;

export class Debris {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(MAX); private py = new Float32Array(MAX); private pz = new Float32Array(MAX);
  private vx = new Float32Array(MAX); private vy = new Float32Array(MAX); private vz = new Float32Array(MAX);
  private life = new Float32Array(MAX); private max = new Float32Array(MAX); private size = new Float32Array(MAX);
  private rot = new Float32Array(MAX); private spin = new Float32Array(MAX); private kind = new Uint8Array(MAX);
  private head = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private c = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < MAX; i++) {
      this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
  }

  private add(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, kind: number): void {
    const i = this.head;
    this.head = (i + 1) % MAX;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life; this.size[i] = size;
    this.rot[i] = rnd() * 6; this.spin[i] = rndSigned() * 14; this.kind[i] = kind;
  }

  /** Bright orange sparks. (vx,vy,vz) is the bulk velocity they are thrown with. */
  sparks(x: number, y: number, z: number, vx: number, vy: number, vz: number, n: number): void {
    for (let k = 0; k < n; k++) {
      this.add(x + rndSigned() * 0.4, y + rnd() * 0.3, z + rndSigned() * 0.8,
        vx * 0.3 + rndSigned() * 7, vy + rnd() * 6, vz * 0.3 + rndSigned() * 7, 0.5 + rnd() * 0.7, 0.05 + rnd() * 0.05, 0);
    }
  }

  /** Red and white boom pieces. */
  pieces(x: number, y: number, z: number, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      this.add(x + rndSigned() * 1.2, y, z + rndSigned() * 0.3,
        rndSigned() * speed, 3 + rnd() * speed * 0.8, -rnd() * speed * 1.4 + 2, 1.6 + rnd() * 1.0, 0.16 + rnd() * 0.22, 1 + (k & 1));
    }
  }

  update(dt: number): void {
    const m = this.m;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.mesh.setMatrixAt(i, m.makeScale(0, 0, 0));
        continue;
      }
      this.vy[i] -= 15 * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) {
        this.py[i] = 0.05;
        this.vy[i] = -this.vy[i] * 0.32;
        this.vx[i] *= 0.7; this.vz[i] *= 0.7;
      }
      this.rot[i] += this.spin[i] * dt;
      const t = this.life[i] / this.max[i];
      const sz = this.size[i] * (this.kind[i] === 0 ? Math.min(1, t * 2.2) : Math.min(1, t * 3));
      this.p.set(this.px[i], this.py[i], this.pz[i]);
      this.q.setFromEuler(this.e.set(this.rot[i], this.rot[i] * 0.7, 0));
      if (this.kind[i] === 0) this.s.set(sz * 0.6, sz * 0.6, sz * 2.4); else this.s.set(sz * 2.2, sz * 0.5, sz * 0.5);
      this.mesh.setMatrixAt(i, m.compose(this.p, this.q, this.s));
      if (this.kind[i] === 0) this.c.setRGB(6, 2.4 + t * 1.6, 0.5);
      else if (this.kind[i] === 1) this.c.setRGB(1.1, 0.12, 0.1);
      else this.c.setRGB(0.9, 0.9, 0.92);
      this.mesh.setColorAt(i, this.c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    for (let i = 0; i < MAX; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
