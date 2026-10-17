// The stunt arena (特技场): a separate scene with no traffic. A dark open tarmac with long thin red LED lines on the
// ground, cool floodlight towers aimed at the wall, light haze, a curving entrance road, an exit gate, and the wall.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ARENA, WALL } from '../config';
import { SIGNS } from '../ui/i18n';
import { SuctionWall } from './ramp';
import { shared } from './environment';
import { bilingualSign, makeGlowTexture } from './textures';

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Flat quads on the ground: core strips (emissive) and soft glow strips (vertex-colour falloff). */
function lineGeometries(lines: [number, number, number][], width: number, glowW: number) {
  const mkQuad = (x0: number, x1: number, z0: number, z1: number, y: number, c0: [number, number, number], c1: [number, number, number]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1], 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute([...c0, ...c1, ...c1, ...c0], 3));
    g.setIndex([0, 2, 1, 0, 3, 2]);
    return g.toNonIndexed();
  };
  const w = [1, 1, 1] as [number, number, number];
  const core = mergeGeometries(lines.map(([x, z0, z1]) => mkQuad(x - width / 2, x + width / 2, z0, z1, 0.03, w, w)))!;
  const r = [0.3, 0.018, 0.011] as [number, number, number];
  const o = [0, 0, 0] as [number, number, number];
  const glow = mergeGeometries(lines.flatMap(([x, z0, z1]) => [
    mkQuad(x - glowW, x - width / 2, z0, z1, 0.02, o, r), mkQuad(x + width / 2, x + glowW, z0, z1, 0.02, r, o),
  ]))!;
  return { core, glow };
}

export class Arena {
  readonly group = new THREE.Group();
  readonly wall = new SuctionWall();

  constructor(roadMat: THREE.Material) {
    const g = this.group;
    g.visible = false;

    // the tarmac (same wet asphalt as the highway)
    const x0 = -260, x1 = 260, z0 = -260, z1 = 340;
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute([x0, 0, z0, x1, 0, z0, x1, 0, z1, x0, 0, z1], 3));
    fg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const uvs = [x0 / 6, -z0 / 6, x1 / 6, -z0 / 6, x1 / 6, -z1 / 6, x0 / 6, -z1 / 6];
    fg.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    fg.setAttribute('uv1', new THREE.Float32BufferAttribute(uvs.map((v) => v / 5), 2));
    fg.setIndex([0, 2, 1, 0, 3, 2]);
    const floor = new THREE.Mesh(fg, roadMat);
    floor.receiveShadow = true;
    floor.frustumCulled = false;
    g.add(floor);

    // long thin red LED lines on the ground, parallel to the approach
    const xs = [-44, -31, -20, -12, -5.5, 5.5, 12, 20, 31, 44];
    const { core, glow } = lineGeometries(xs.map((x) => [x, 138, WALL.z + 4] as [number, number, number]), 0.16, 1.7);
    g.add(new THREE.Mesh(core, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(2.2, 0.05, 0.035), side: THREE.DoubleSide })));
    const glowMesh = new THREE.Mesh(glow, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    glowMesh.renderOrder = 2;
    g.add(glowMesh);

    // floodlight towers aimed at the wall, with beams in the haze
    const target = new THREE.Vector3(0, 9, WALL.z - 8);
    const towers: [number, number][] = [[-40, 20], [40, 20], [-40, -26], [40, -26]];
    const metal: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    const beams: THREE.BufferGeometry[] = [];
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    for (const [tx, tz] of towers) {
      const pole = new THREE.CylinderGeometry(0.28, 0.42, 17, 8);
      pole.translate(tx, 8.5, tz);
      metal.push(pole.toNonIndexed());
      const head = new THREE.Vector3(tx, 17.2, tz);
      const dir = new THREE.Vector3().subVectors(target, head);
      const len = dir.length();
      dir.normalize();
      const bank = new THREE.PlaneGeometry(3.6, 1.5); // one-sided: dark from behind, so it never glares at the camera
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      m.compose(head, q, one);
      bank.applyMatrix4(m);
      lamps.push(bank.toNonIndexed());
      const cone = new THREE.ConeGeometry(6, len, 24, 1, true);
      cone.translate(0, -len / 2, 0); // apex at the lamp, axis along -y
      const pos = cone.getAttribute('position');
      const along = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) along[i] = Math.min(1, Math.max(0, -pos.getY(i) / len)); // 0 at the lamp, 1 at the wall
      cone.setAttribute('along', new THREE.BufferAttribute(along, 1));
      q.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
      m.compose(p.copy(head), q, one);
      cone.applyMatrix4(m);
      cone.deleteAttribute('uv');
      beams.push(cone.toNonIndexed());
    }
    g.add(new THREE.Mesh(mergeGeometries(metal)!, new THREE.MeshStandardMaterial({ color: 0x30343b, metalness: 0.7, roughness: 0.5 })));
    g.add(new THREE.Mesh(mergeGeometries(lamps)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 3.0, 3.8) })));
    // light shafts: additive, very faint, soft at the sides (the surface normal fades out toward the silhouette) and
    // fading along their length; the haze sprites below carry most of the glow
    const beamMat = new THREE.ShaderMaterial({
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(0.52, 0.68, 1.0) }, uStrength: { value: 0.05 } },
      vertexShader: `
        attribute float along;
        varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main() {
          vAlong = along;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vN = normalize(normalMatrix * normal);
          vV = normalize(-mv.xyz);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform vec3 uColor; uniform float uStrength;
        varying float vAlong; varying vec3 vN; varying vec3 vV;
        void main() {
          float side = pow(abs(dot(normalize(vN), normalize(vV))), 2.4); // 0 at the edge of the shaft, 1 in the middle
          float len = pow(1.0 - vAlong, 1.7) * smoothstep(0.0, 0.12, vAlong); // dies out toward the wall, no hot tip at the lamp
          gl_FragColor = vec4(uColor, uStrength * side * len);
        }`,
    });
    const beamMesh = new THREE.Mesh(mergeGeometries(beams)!, beamMat);
    beamMesh.renderOrder = 3;
    g.add(beamMesh);

    // haze
    const glowTex = makeGlowTexture(128, 1.6);
    for (const [hx, hy, hz, sc] of [[0, 8, WALL.z - 4, 46], [0, 3, WALL.z + 22, 36]] as [number, number, number, number][]) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(0.045, 0.062, 0.1), blending: THREE.AdditiveBlending, depthWrite: false }));
      s.position.set(hx, hy, hz);
      s.scale.setScalar(sc);
      g.add(s);
    }

    // the curving entrance road, with red LED edges
    const N = 20, hw = 3.4;
    const pos: number[] = [], nor: number[] = [], uv: number[] = [], uv1: number[] = [], idx: number[] = [], ledPos: number[] = [], ledIdx: number[] = [];
    const cx = (u: number) => 24 * (1 - smooth(u));
    for (let r = 0; r <= N; r++) {
      const u = r / N;
      const z = 252 - u * (252 - ARENA.spawnZ);
      for (const sx of [-1, 1]) {
        const x = cx(u) + sx * hw;
        pos.push(x, 0.012, z); nor.push(0, 1, 0); uv.push(x / 6, -z / 6); uv1.push(x / 30, -z / 30);
        const ex = cx(u) + sx * (hw - 0.14), ex2 = cx(u) + sx * hw;
        ledPos.push(ex, 0.04, z, ex2, 0.04, z);
      }
      if (r > 0) {
        const a = (r - 1) * 2, b = a + 1, c = r * 2, d = c + 1;
        idx.push(a, c, b, b, c, d);
        const la = (r - 1) * 4, lc = r * 4;
        ledIdx.push(la, lc, la + 1, la + 1, lc, lc + 1, la + 2, lc + 2, la + 3, la + 3, lc + 2, lc + 3);
      }
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    rg.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
    rg.setIndex(idx);
    g.add(new THREE.Mesh(rg, roadMat));
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(ledPos, 3));
    lg.setIndex(ledIdx);
    g.add(new THREE.Mesh(lg, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 0.05, 0.035), side: THREE.DoubleSide })));

    // the venue gate: driving out through it fades back to the highway
    const gz = ARENA.gateZ;
    const post = (x: number) => { const b = new THREE.BoxGeometry(0.6, 8, 0.6); b.translate(x, 4, gz); return b.toNonIndexed(); };
    const beam = new THREE.BoxGeometry(14, 0.8, 0.8);
    beam.translate(0, 8.4, gz);
    g.add(new THREE.Mesh(mergeGeometries([post(-6.6), post(6.6), beam.toNonIndexed()])!, new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.5, envMap: shared.env, envMapIntensity: 0.4 })));
    const gateSign = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 2.2),
      new THREE.MeshBasicMaterial({ map: bilingualSign(SIGNS.gateOut[0], SIGNS.gateOut[1], 1024, 230, '#0b6a3a', '#ffffff', { zhPx: 120, enPx: 62, border: '#ffffff' }), color: new THREE.Color(1.2, 1.2, 1.2), side: THREE.DoubleSide }),
    );
    gateSign.position.set(0, 6.9, gz);
    g.add(gateSign);
    const portal = new THREE.Mesh(
      new THREE.PlaneGeometry(12.6, 7.4),
      new THREE.MeshBasicMaterial({ map: makeGlowTexture(64, 1.1), color: new THREE.Color(0.4, 0.5, 1.1), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    );
    portal.position.set(0, 3.8, gz + 0.1);
    portal.renderOrder = 3;
    g.add(portal);

    g.add(this.wall.group);
  }

  update(time: number): void {
    this.wall.update(time);
  }
}
