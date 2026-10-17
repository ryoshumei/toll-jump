// The highway exit ramp to the stunt arena (特技场匝道): bilingual signs at 1 km and 500 m, a ramp that peels off the
// right lane through an opening in the barrier, and a glowing gate. ONE pooled kit, moved to the nearest exit.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EXIT, ROAD } from '../config';
import { exitZ, nearestExit } from '../sim/course';
import { SIGNS } from '../ui/i18n';
import { gantry } from './tollPlaza';
import { bilingualSign, makeGlowTexture } from './textures';

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const X0 = 3 * ROAD.halfLane;
const X1 = 2 * ROAD.laneW + ROAD.shoulder + EXIT.lateral;
export const rampX = (u: number): number => X0 + (X1 - X0) * smooth(u);

/** A ribbon of asphalt along the ramp centre line, with LED edges and glow. Local coordinates (z' <= 0). */
function rampGeometries(): { road: THREE.BufferGeometry; led: THREE.BufferGeometry; glow: THREE.BufferGeometry } {
  const N = 18;
  const hw = EXIT.width / 2;
  const mk = (cols: number[], y: number, color?: (c: number) => [number, number, number]) => {
    const pos: number[] = []; const uv: number[] = []; const uv1: number[] = []; const col: number[] = []; const idx: number[] = [];
    for (let r = 0; r <= N; r++) {
      const u = r / N;
      const zl = -u * EXIT.length;
      for (let c = 0; c < cols.length; c++) {
        const x = rampX(u) + cols[c];
        pos.push(x, y, zl);
        uv.push(x / 6, -zl / 6);
        uv1.push(x / 30 + 0.37, -zl / 30);
        if (color) col.push(...color(c));
      }
      if (r > 0) {
        const n = cols.length;
        for (let c = 0; c < n - 1; c++) {
          const a = (r - 1) * n + c, b = a + 1, d = r * n + c, e = d + 1;
          idx.push(a, d, b, b, d, e);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    return g;
  };
  const road = mk([-hw, hw], 0.01);
  const led = mergeGeometries([mk([-hw, -hw + 0.14], 0.045), mk([hw - 0.14, hw], 0.045)].map((g) => g.toNonIndexed()))!;
  const red = (v: number): [number, number, number] => [0.3 * v, 0.018 * v, 0.011 * v];
  const glow = mergeGeometries([
    mk([-hw - 1.6, -hw], 0.02, (c) => red(c === 0 ? 0 : 1)),
    mk([hw, hw + 1.6], 0.02, (c) => red(c === 0 ? 1 : 0)),
  ].map((g) => g.toNonIndexed()))!;
  return { road, led, glow };
}

export class ExitRamp {
  readonly group = new THREE.Group();
  idx = -1;

  constructor(roadMat: THREE.Material) {
    const g = this.group;
    const { road, led, glow } = rampGeometries();
    const rm = new THREE.Mesh(road, roadMat);
    rm.receiveShadow = true;
    g.add(rm);
    g.add(new THREE.Mesh(led, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.05, 0.035), side: THREE.DoubleSide })));
    const gl = new THREE.Mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    gl.renderOrder = 2;
    g.add(gl);

    // the gate at the end of the ramp, with a violet portal
    const gx = rampX(1);
    const gz = -EXIT.length;
    const hw = EXIT.width / 2 + 0.8;
    const post = (x: number) => { const m = new THREE.BoxGeometry(0.5, 8, 0.5); m.translate(x, 4, gz); return m.toNonIndexed(); };
    const beam = new THREE.BoxGeometry(2 * hw + 1, 0.7, 0.7);
    beam.translate(gx, 8.2, gz);
    g.add(new THREE.Mesh(mergeGeometries([post(gx - hw), post(gx + hw), beam.toNonIndexed()])!, new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.5 })));
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * hw + 0.6, 2.2),
      new THREE.MeshBasicMaterial({ map: bilingualSign(SIGNS.arena[0], SIGNS.arena[1], 1024, 280, '#120a2a', '#e9dcff', { zhPx: 140, enPx: 70, glow: 22, accent: '#8a5bff' }), color: new THREE.Color(1.5, 1.5, 1.5) }),
    );
    sign.position.set(gx, 6.6, gz + 0.4);
    g.add(sign);
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * hw, 7.6),
      new THREE.MeshBasicMaterial({ map: makeGlowTexture(64, 1.1), color: new THREE.Color(0.55, 0.4, 1.3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    portal.position.set(gx, 3.8, gz - 0.1);
    portal.renderOrder = 3;
    g.add(portal);

    // bilingual exit signs over the highway, 1 km and 500 m before the ramp
    const far = gantry(bilingualSign('↗ ' + SIGNS.exitFar[0], SIGNS.exitFar[1], 1024, 320, '#0b6a3a', '#ffffff', { zhPx: 128, enPx: 66, glow: 6, border: '#ffffff' }), 9, 2.8);
    far.position.z = EXIT.signFar;
    const near = gantry(bilingualSign('↗ ' + SIGNS.exitNear[0], SIGNS.exitNear[1], 1024, 320, '#0b6a3a', '#ffffff', { zhPx: 128, enPx: 66, glow: 6, border: '#ffffff' }), 9, 2.8);
    near.position.z = EXIT.signNear;
    g.add(far, near);
    g.visible = false;
    this.place(0);
  }

  place(i: number): void {
    this.idx = i;
    this.group.position.z = exitZ(i);
  }

  update(carZ: number): void {
    const i = nearestExit(carZ);
    if (i !== this.idx) this.place(i);
    const dz = carZ - exitZ(this.idx);
    this.group.visible = dz < EXIT.signFar + 80 && dz > -EXIT.length - 120;
  }

  /** Warm-up helper: show the kit in front of the camera. The next update() puts it back where it belongs. */
  forceVisible(z: number): void {
    this.group.position.z = z;
    this.group.visible = true;
    this.idx = -1;
  }
}
