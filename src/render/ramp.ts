// The stunt arena's wall (特技场, from v1): a curved road about 7 m wide, white concrete with a dashed centre line,
// red LED strips on both edges and a steel truss behind it. Flat at ground level, up through vertical, and 15 degrees
// past it, so the ~20 m tip leans back over the approach. Renders the shape from src/sim/wall.ts.
import * as THREE from 'three';
import { WALL } from '../config';
import { WALL_LENGTH, wallPose, type WallPose } from '../sim/wall';
import { shared } from './environment';
import { canvasTexture, makeAlphaTexture } from './textures';

const N = 112;
const P: WallPose = { z: 0, y: 0, theta: 0 };

/** A ribbon swept along the wall between lateral offsets x0..x1, pushed off the surface by `off` along its normal. */
function sweep(x0: number, x1: number, off: number, colors?: [number, number, number][]): THREE.BufferGeometry {
  const pos: number[] = []; const nor: number[] = []; const uv: number[] = []; const col: number[] = []; const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = (i / N) * WALL_LENGTH;
    wallPose(s, P);
    const ny = Math.cos(P.theta), nz = Math.sin(P.theta);
    for (let j = 0; j < 2; j++) {
      const x = j === 0 ? x0 : x1;
      pos.push(x, P.y + ny * off + 0.012, P.z + nz * off);
      nor.push(0, ny, nz);
      uv.push(x / (WALL.halfWidth * 2) + 0.5, s / 2);
      if (colors) col.push(...colors[j]);
    }
    if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

export class SuctionWall {
  readonly group = new THREE.Group();
  private beaconMat: THREE.MeshBasicMaterial;

  constructor() {
    const g = this.group;
    const hw = WALL.halfWidth;
    g.position.set(WALL.x, 0, WALL.z);

    // white concrete with a dashed centre line
    const tex = canvasTexture(256, 256, (c, w, h) => {
      c.fillStyle = '#e5e6e9';
      c.fillRect(0, 0, w, h);
      let s = 11;
      for (let i = 0; i < 700; i++) {
        s = (s * 16807) % 2147483647;
        const x = (s % 997) / 997 * w;
        s = (s * 16807) % 2147483647;
        const y = (s % 991) / 991 * h;
        c.fillStyle = `rgba(120,126,136,${0.05 + (s % 7) / 90})`;
        c.fillRect(x, y, 2 + (s % 3), 2);
      }
      c.fillStyle = '#c3c7cf';
      c.fillRect(0, 0, w, 3);
      c.fillRect(w / 2 - 3, h * 0.1, 6, h * 0.64); // the dashed centre line: 1.3 m dash, 0.7 m gap
      c.fillStyle = 'rgba(150,156,168,.4)';
      c.fillRect(w * 0.18, 0, 1, h);
      c.fillRect(w * 0.82, 0, 1, h);
    });
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const ribbon = new THREE.Mesh(
      sweep(-hw, hw, 0),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.02, emissive: 0x2b2d31, emissiveMap: tex, emissiveIntensity: 0.55, side: THREE.DoubleSide, envMap: shared.env, envMapIntensity: 0.4 }),
    );
    ribbon.castShadow = true;
    ribbon.receiveShadow = true;
    g.add(ribbon);

    // red LED strips on both edges, their glow on the surface, and dark rails outside them
    const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.05, 0.035), side: THREE.DoubleSide });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x24272d, metalness: 0.7, roughness: 0.45, side: THREE.DoubleSide });
    const red: [number, number, number] = [0.26, 0.016, 0.01];
    const none: [number, number, number] = [0, 0, 0];
    for (const s of [-1, 1]) {
      const a = s * (hw - 0.04), b = s * (hw - 0.2), inner = s * (hw - 0.9);
      g.add(new THREE.Mesh(sweep(Math.min(a, b), Math.max(a, b), 0.03), ledMat));
      const gl = new THREE.Mesh(sweep(Math.min(a, inner), Math.max(a, inner), 0.025, s > 0 ? [none, red] : [red, none]), glowMat);
      gl.renderOrder = 2;
      g.add(gl);
      g.add(new THREE.Mesh(sweep(s * hw, s * (hw + 0.3), 0.05), railMat));
    }

    // steel truss behind the curve: chords, rungs, diagonals, cross ties and back legs as instanced beams
    const beams: [THREE.Vector3, THREE.Vector3][] = [];
    const inner = (s: number, x: number) => { wallPose(s, P); return new THREE.Vector3(x, P.y - Math.cos(P.theta) * 0.5, P.z - Math.sin(P.theta) * 0.5); };
    const outer = (s: number, x: number) => { wallPose(s, P); return new THREE.Vector3(x, P.y - Math.cos(P.theta) * 2.4, P.z - Math.sin(P.theta) * 2.4); };
    const K = 16;
    for (const sx of [-1, 1]) {
      const x = sx * (hw + 0.14);
      for (let k = 0; k < K; k++) {
        const s0 = (k / K) * WALL_LENGTH, s1 = ((k + 1) / K) * WALL_LENGTH;
        beams.push([inner(s0, x), inner(s1, x)], [outer(s0, x), outer(s1, x)], [inner(s0, x), outer(s0, x)]);
        beams.push(k % 2 === 0 ? [inner(s0, x), outer(s1, x)] : [outer(s0, x), inner(s1, x)]);
      }
      beams.push([inner(WALL_LENGTH, x), outer(WALL_LENGTH, x)]);
      for (const f of [0.35, 0.55, 0.75, 0.92]) {
        const o = outer(f * WALL_LENGTH, x);
        beams.push([o, new THREE.Vector3(x, 0, o.z - 3.2)]);
      }
    }
    for (let k = 1; k <= K; k += 2) {
      const s = (k / K) * WALL_LENGTH;
      beams.push([outer(s, -hw - 0.14), outer(s, hw + 0.14)], [inner(s, -hw - 0.14), inner(s, hw + 0.14)]);
    }
    const beamMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x3a3f47, metalness: 0.75, roughness: 0.45, envMap: shared.env, envMapIntensity: 0.4 }), beams.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), dir = new THREE.Vector3();
    const Z = new THREE.Vector3(0, 0, 1);
    beams.forEach(([a, b], i) => {
      dir.subVectors(b, a);
      const len = dir.length();
      q.setFromUnitVectors(Z, dir.normalize());
      pos.addVectors(a, b).multiplyScalar(0.5);
      m4.compose(pos, q, scl.set(0.1, 0.1, len));
      beamMesh.setMatrixAt(i, m4);
    });
    beamMesh.castShadow = true;
    g.add(beamMesh);

    // red aviation beacon on the tip, and a pool of light where the car drives on
    wallPose(WALL_LENGTH, P);
    this.beaconMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.2, 0.15) });
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), this.beaconMat);
    beacon.position.set(0, P.y + 0.3, P.z + 0.1);
    g.add(beacon);
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(15, 26),
      new THREE.MeshBasicMaterial({
        map: makeAlphaTexture(64, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x, y)), 1.5)),
        color: new THREE.Color(0.5, 0.6, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(0, 0.03, 8);
    pool.renderOrder = 1;
    g.add(pool);
  }

  update(time: number): void {
    const k = 0.55 + 0.45 * Math.sin(time * 3.2);
    this.beaconMat.color.setRGB(6 * k, 0.2 * k, 0.15 * k);
  }
}
