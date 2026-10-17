// Toll plaza kit (the meme). ONE pooled kit that is moved to the next plaza as the player drives on:
// canopy (underside 6 m, top 7 m, 20 m deep), glowing bilingual fascia sign, price board, pillars, booth islands
// with lit cabins, 6 wide lanes (5.5 m openings, 1.2 m islands). About half the lanes are ETC lanes (purple ETC
// board, green signal, boom lifts by itself); the manual lanes keep a striped boom down across them.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PLAZA, ROAD } from '../config';
import { nearestPlaza, plazaZ } from '../sim/course';
import { PLAZA_LANES, isEtcLane, laneCenterX, tollPrice, type TollTracker } from '../sim/toll';
import { SIGNS } from '../ui/i18n';
import { shared } from './environment';
import { bilingualSign, canvasTexture, makeAlphaTexture, redrawBilingual } from './textures';

const P = ROAD.plazaPitch;
const HALF = (PLAZA_LANES - 1) / 2;
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);
const box = (w: number, h: number, d: number, x: number, y: number, z: number, r = 0.04) => {
  const g = new RoundedBoxGeometry(w, h, d, 1, r);
  g.translate(x, y, z);
  return ni(g);
};
const basic = (map: THREE.Texture | null, gain: number, extra: THREE.MeshBasicMaterialParameters = {}) =>
  new THREE.MeshBasicMaterial({ map, color: new THREE.Color(gain, gain, gain), ...extra });

function signalTex(kind: 'go' | 'stop'): THREE.CanvasTexture {
  return canvasTexture(128, 128, (g) => {
    g.fillStyle = '#04070a';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = kind === 'go' ? '#35ff7a' : '#ff3434';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = 12;
    g.lineCap = 'round';
    g.shadowColor = g.strokeStyle;
    g.shadowBlur = 16;
    if (kind === 'go') {
      g.beginPath(); g.moveTo(64, 20); g.lineTo(64, 100); g.stroke();
      g.beginPath(); g.moveTo(32, 66); g.lineTo(64, 102); g.lineTo(96, 66); g.stroke();
    } else {
      g.beginPath(); g.moveTo(30, 30); g.lineTo(98, 98); g.stroke();
      g.beginPath(); g.moveTo(98, 30); g.lineTo(30, 98); g.stroke();
    }
  });
}

function stripeTex(c1: string, c2: string, n: number, diagonal: boolean): THREE.CanvasTexture {
  const t = canvasTexture(256, 64, (g, W, H) => {
    g.fillStyle = c1;
    g.fillRect(0, 0, W, H);
    g.fillStyle = c2;
    const sw = W / n;
    for (let i = 0; i < n; i += 2) {
      if (diagonal) {
        g.beginPath();
        g.moveTo(i * sw, 0); g.lineTo((i + 1) * sw, 0); g.lineTo((i + 1) * sw - H * 0.6, H); g.lineTo(i * sw - H * 0.6, H);
        g.fill();
      } else {
        g.fillRect(i * sw, 0, sw, H);
      }
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A sign gantry over the 4-lane highway. Exported for the exit ramp signs too. */
export function gantry(sign: THREE.Texture, w: number, h: number): THREE.Group {
  const g = new THREE.Group();
  const hw = 10.5;
  const posts = mergeGeometries([box(0.55, 8.4, 0.55, -hw - 1.1, 4.2, 0), box(0.55, 8.4, 0.55, hw + 1.1, 4.2, 0), box(2 * hw + 3.2, 0.6, 0.8, 0, 8.1, 0)])!;
  g.add(new THREE.Mesh(posts, new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.7, roughness: 0.5 })));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), basic(sign, 1.15));
  panel.position.set(0, 8.1 - 0.3 - h / 2 + 0.05, 0.43);
  g.add(panel);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.3, h + 0.3), new THREE.MeshStandardMaterial({ color: 0x15181c, roughness: 0.7 }));
  back.position.set(0, panel.position.y, 0.41);
  g.add(back);
  return g;
}

export class TollPlaza {
  readonly group = new THREE.Group();
  j = -1;
  private priceTex: THREE.CanvasTexture;
  private booms: THREE.InstancedMesh;
  private goSig: THREE.InstancedMesh;
  private stopSig: THREE.InstancedMesh;
  private etcBoards: THREE.InstancedMesh;
  private armBroken = new Uint8Array(PLAZA_LANES);
  private lift = new Float32Array(PLAZA_LANES);
  private etc = new Uint8Array(PLAZA_LANES);
  private armHalf = (P - 2 * PLAZA.islandHalfWidth) / 2;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private pp = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private Z = new THREE.Vector3(0, 0, 1);

  constructor() {
    const g = this.group;
    const W = PLAZA.canopyHalfWidth;
    const D = PLAZA.canopyHalfDepth;

    // --- structure: slab, valance, pillars, signal rods ---
    const parts: THREE.BufferGeometry[] = [
      box(2 * W, PLAZA.canopyTop - PLAZA.canopyUnder, 2 * D, 0, (PLAZA.canopyTop + PLAZA.canopyUnder) / 2, 0, 0.1),
      box(2 * W, PLAZA.canopyUnder - PLAZA.valanceBottom, 0.4, 0, (PLAZA.canopyUnder + PLAZA.valanceBottom) / 2, D - 0.2, 0.05),
    ];
    for (let k = -3; k <= 3; k++) {
      for (const sz of [-1, 1]) parts.push(box(PLAZA.pillarHalf * 2, PLAZA.pillarHeight - PLAZA.islandHeight, PLAZA.pillarHalf * 2, k * P, (PLAZA.pillarHeight + PLAZA.islandHeight) / 2, sz * PLAZA.pillarZ, 0.05));
    }
    for (let l = 0; l < PLAZA_LANES; l++) {
      const x = laneCenterX(l);
      parts.push(box(0.05, 1.5, 0.05, x - 0.3, 5.3, 9.2, 0.01), box(0.05, 1.5, 0.05, x + 0.3, 5.3, 9.2, 0.01));
    }
    g.add(new THREE.Mesh(mergeGeometries(parts)!, new THREE.MeshStandardMaterial({ color: 0x20242b, metalness: 0.55, roughness: 0.5, envMap: shared.env, envMapIntensity: 0.4 })));

    // glowing underside: a lit ceiling plus rows of LED strips
    const gridTex = canvasTexture(256, 128, (c, w, h) => {
      c.fillStyle = '#4c5a68';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#c9d8e6';
      for (let i = 0; i < 8; i++) for (let j = 0; j < 4; j++) c.fillRect(i * 32 + 3, j * 32 + 3, 26, 26);
    });
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * W - 0.6, 2 * D - 0.6), basic(gridTex, 0.23));
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, PLAZA.canopyUnder - 0.01, 0);
    g.add(ceil);
    const strips: THREE.BufferGeometry[] = [];
    for (const z of [-8, -4, 0, 4, 8]) strips.push(box(2 * W - 1.2, 0.05, 0.12, 0, PLAZA.canopyUnder - 0.05, z, 0.01));
    g.add(new THREE.Mesh(mergeGeometries(strips)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.86, 1.15) })));
    g.add(new THREE.Mesh(box(2 * W, 0.06, 0.06, 0, PLAZA.canopyTop + 0.04, D, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.2, 1.9) })));

    // --- bilingual fascia sign and boards on the front of the valance ---
    const fascia = new THREE.Mesh(
      new THREE.PlaneGeometry(27, 2.0),
      basic(bilingualSign(SIGNS.fascia[0], SIGNS.fascia[1], 2048, 160, '#04080c', '#e8f7ff', { zhPx: 92, enPx: 44, glow: 22, accent: '#ff2a2a' }), 1.05),
    );
    fascia.position.set(0, 5.85, D + 0.02);
    g.add(fascia);
    const px = W - 3.2;
    this.priceTex = bilingualSign(...SIGNS.price(45), 1024, 256, '#050403', '#ffb02e', { zhPx: 110, enPx: 70, glow: 18, accent: '#ff9a00' });
    const priceR = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.95), basic(this.priceTex, 1.0));
    priceR.position.set(px, 5.85, D + 0.02);
    g.add(priceR);
    const etcSign = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.95), basic(bilingualSign('ETC 通道', 'ETC LANES', 1024, 356, '#0a0414', '#d9b8ff', { zhPx: 150, enPx: 90, glow: 22, accent: '#8a3dff' }), 1.0));
    etcSign.position.set(-px, 5.85, D + 0.02);
    g.add(etcSign);
    const haze = new THREE.Mesh(
      new THREE.PlaneGeometry(38, 5),
      new THREE.MeshBasicMaterial({ map: makeAlphaTexture(64, (x, y) => Math.pow(Math.max(0, 1 - Math.hypot(x * 0.55, y)), 2.2)), color: new THREE.Color(0.04, 0.12, 0.16), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    haze.position.set(0, 5.85, D + 0.15);
    g.add(haze);

    // --- islands (1.2 m), noses, cabins, windows ---
    const islandParts: THREE.BufferGeometry[] = [];
    const noseParts: THREE.BufferGeometry[] = [];
    const cabinParts: THREE.BufferGeometry[] = [];
    const winParts: THREE.BufferGeometry[] = [];
    const hh = PLAZA.islandHalfLen;
    const nose = new THREE.Shape();
    nose.moveTo(-PLAZA.islandHalfWidth, 0); nose.lineTo(PLAZA.islandHalfWidth, 0); nose.lineTo(0.18, 3.2); nose.lineTo(-0.18, 3.2); nose.closePath();
    for (let k = -3; k <= 3; k++) {
      const x = k * P;
      islandParts.push(box(PLAZA.islandHalfWidth * 2, PLAZA.islandHeight, hh * 2, x, PLAZA.islandHeight / 2, 0, 0.05));
      for (const sz of [-1, 1]) {
        const ng = new THREE.ExtrudeGeometry(nose, { depth: PLAZA.islandHeight, bevelEnabled: false });
        ng.rotateX(-Math.PI / 2);
        if (sz > 0) { ng.rotateY(Math.PI); ng.translate(x, 0, hh); } else { ng.translate(x, 0, -hh); }
        noseParts.push(ni(ng));
      }
      cabinParts.push(box(PLAZA.boothHalfWidth * 2, PLAZA.boothHeight, PLAZA.boothHalfLen * 2, x, PLAZA.islandHeight + PLAZA.boothHeight / 2, 0, 0.09));
      cabinParts.push(box(1.5, 0.12, 3.9, x, PLAZA.islandHeight + PLAZA.boothHeight + 0.06, 0, 0.03));
      cabinParts.push(box(0.5, 1.1, 0.45, x + (k % 2 === 0 ? 0.55 : -0.55), 0.3 + 0.55, PLAZA.boomZ, 0.06)); // boom housing
      for (const sx of [-1, 1]) {
        const w = new THREE.PlaneGeometry(2.6, 1.05);
        w.rotateY(sx * Math.PI / 2);
        w.translate(x + sx * (PLAZA.boothHalfWidth + 0.012), PLAZA.islandHeight + 1.45, 0);
        winParts.push(ni(w));
      }
    }
    const islands = new THREE.Mesh(mergeGeometries(islandParts)!, new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.85 }));
    islands.receiveShadow = true;
    g.add(islands);
    g.add(new THREE.Mesh(mergeGeometries(noseParts)!, new THREE.MeshStandardMaterial({ map: stripeTex('#101114', '#ffcc19', 8, true), roughness: 0.6, emissive: 0x201800, side: THREE.DoubleSide })));
    g.add(new THREE.Mesh(mergeGeometries(cabinParts)!, new THREE.MeshStandardMaterial({ color: 0xd5d9de, roughness: 0.45, metalness: 0.2, emissive: 0x16181b })));
    g.add(new THREE.Mesh(mergeGeometries(winParts)!, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.78, 0.6, 0.34), side: THREE.DoubleSide })));

    // --- booms: red and white striped. ETC lanes lift by themselves; manual lanes stay down. ---
    const st = stripeTex('#f4f4f4', '#e11d1d', 12, false);
    this.booms = new THREE.InstancedMesh(new RoundedBoxGeometry(this.armHalf * 2 - 0.05, 0.13, 0.13, 1, 0.04), new THREE.MeshStandardMaterial({ map: st, roughness: 0.5, emissive: 0x2a0707 }), PLAZA_LANES);
    this.booms.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.booms.frustumCulled = false;
    g.add(this.booms);

    // --- signals: green for ETC lanes (under a purple ETC board), red X for manual lanes ---
    const sigGeo = new THREE.PlaneGeometry(0.95, 0.95);
    this.goSig = new THREE.InstancedMesh(sigGeo, basic(signalTex('go'), 1.15), PLAZA_LANES);
    this.stopSig = new THREE.InstancedMesh(sigGeo, basic(signalTex('stop'), 1.15), PLAZA_LANES);
    this.etcBoards = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(2.4, 1.1),
      basic(bilingualSign('ETC', 'ELECTRONIC TOLL', 512, 240, '#2a0a63', '#ffffff', { zhPx: 130, enPx: 44, glow: 10, accent: '#b080ff' }), 1.0),
      PLAZA_LANES,
    );
    g.add(this.goSig, this.stopSig, this.etcBoards);

    // light spilling onto the road under the canopy
    const spill = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * W + 8, 2 * D + 14),
      new THREE.MeshBasicMaterial({
        map: makeAlphaTexture(64, (x, y) => Math.pow(Math.max(0, 1 - Math.max(Math.abs(x), Math.abs(y * 1.1))), 1.6)),
        color: new THREE.Color(0.09, 0.11, 0.15), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    spill.rotation.x = -Math.PI / 2;
    spill.position.y = 0.035;
    spill.renderOrder = 1;
    g.add(spill);

    // --- approach gantries: 500 m and 250 m before the booths (bilingual) ---
    const g500 = gantry(bilingualSign(SIGNS.ahead[0], SIGNS.ahead[1], 1024, 320, '#0b6a3a', '#ffffff', { zhPx: 130, enPx: 62, glow: 6, border: '#ffffff' }), 9, 2.8);
    g500.position.z = PLAZA.signFar;
    const g250 = gantry(bilingualSign(SIGNS.etcAhead[0], SIGNS.etcAhead[1], 1024, 320, '#0b6a3a', '#ffffff', { zhPx: 120, enPx: 62, glow: 6, border: '#ffffff' }), 9, 2.8);
    g250.position.z = PLAZA.signEtc;
    g.add(g500, g250);

    g.visible = false;
    this.place(0, null);
  }

  private writeArm(l: number): void {
    if (this.armBroken[l]) {
      this.m.makeScale(0, 0, 0);
    } else {
      const h = this.armHalf;
      const a = this.lift[l] * 1.35; // an ETC boom swings up to about 77 degrees
      this.q.setFromAxisAngle(this.Z, a);
      this.pp.set(laneCenterX(l) - h + Math.cos(a) * h, PLAZA.boomY0 + 0.13 + Math.sin(a) * h, PLAZA.boomZ);
      this.m.compose(this.pp, this.q, this.s.set(1, 1, 1));
    }
    this.booms.setMatrixAt(l, this.m);
  }

  /** Move the kit to plaza j; redraw the price; set the lane signals and ETC boards; restore the booms. */
  place(j: number, tracker: TollTracker | null): void {
    this.j = j;
    this.group.position.z = plazaZ(j);
    redrawBilingual(this.priceTex, ...SIGNS.price(tollPrice(j)), '#050403', '#ffb02e', { zhPx: 110, enPx: 70, glow: 18, accent: '#ff9a00' });
    let go = 0, stop = 0, boards = 0;
    for (let l = 0; l < PLAZA_LANES; l++) {
      const e = isEtcLane(j, l);
      this.etc[l] = e ? 1 : 0;
      const x = laneCenterX(l);
      this.s.set(1, 1, 1);
      if (e) {
        this.m.compose(this.pp.set(x, 4.7, 9.2), this.q.identity(), this.s);
        this.etcBoards.setMatrixAt(boards++, this.m);
        this.m.compose(this.pp.set(x, 3.75, 9.2), this.q.identity(), this.s.set(0.55, 0.55, 1));
        this.goSig.setMatrixAt(go++, this.m);
      } else {
        this.m.compose(this.pp.set(x, 4.1, 9.2), this.q.identity(), this.s);
        this.stopSig.setMatrixAt(stop++, this.m);
      }
      this.lift[l] = 0;
      this.armBroken[l] = tracker !== null && tracker.boomPlaza === j && tracker.boomBroken[l] === 1 ? 1 : 0;
      this.writeArm(l);
    }
    this.s.set(1, 1, 1);
    this.goSig.count = go;
    this.stopSig.count = stop;
    this.etcBoards.count = boards;
    for (const im of [this.goSig, this.stopSig, this.etcBoards, this.booms]) im.instanceMatrix.needsUpdate = true;
  }

  /** Follow the car: keep the kit on the nearest plaza, lift ETC booms for a car heading into their lane. */
  update(carZ: number, carX: number, tracker: TollTracker, dt: number): void {
    const j = nearestPlaza(carZ);
    if (j !== this.j) this.place(j, tracker);
    const pz = plazaZ(this.j);
    this.group.visible = Math.abs(carZ - pz) < 760;
    if (!this.group.visible) return;
    const zl = carZ - pz;
    let dirty = false;
    for (let l = 0; l < PLAZA_LANES; l++) {
      if (!this.etc[l]) continue;
      const near = zl > PLAZA.boomZ - 5 && zl < PLAZA.boomZ + 42 && Math.abs(carX - laneCenterX(l)) < P / 2;
      const target = near ? 1 : 0;
      const prev = this.lift[l];
      this.lift[l] += (target - prev) * (1 - Math.exp(-12 * dt));
      if (Math.abs(this.lift[l] - prev) > 0.0005) { this.writeArm(l); dirty = true; }
    }
    if (dirty) this.booms.instanceMatrix.needsUpdate = true;
  }

  /** The highest boom lift right now, 0 = all down .. 1 = up (only the lane the car is heading into lifts). For checks. */
  maxLift(): number {
    let m = 0;
    for (let l = 0; l < PLAZA_LANES; l++) if (this.lift[l] > m) m = this.lift[l];
    return m;
  }

  /** Snap one (manual-lane) boom off. Returns its world position for the debris burst. */
  breakBoom(lane: number, out: THREE.Vector3): THREE.Vector3 {
    this.armBroken[lane] = 1;
    this.writeArm(lane);
    this.booms.instanceMatrix.needsUpdate = true;
    return out.set(laneCenterX(lane), 1.0, plazaZ(this.j) + PLAZA.boomZ);
  }

  /** Warm-up helper: show the kit right in front of the camera. */
  forceVisible(z: number): void {
    this.group.position.z = z;
    this.group.visible = true;
    this.j = -1; // the next update() puts it back
  }

  get halfWidthLanes(): number { return HALF; }
}
