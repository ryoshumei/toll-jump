// Thruster FX (the money shot): nested additive plume cones (white core, cyan-white sheath, scrolling noise and
// flicker), a glare sprite at every nozzle, one cold-white PointLight under the car, and the smoke emission rules.
import * as THREE from 'three';
import type { CarModel } from './roadster';
import { rnd, rndSigned, type SmokeSystem } from './smoke';
import { makeNoiseTexture } from './textures';

const N_PLUMES = 6; // 4 down + 2 rear
const MAX_GLARE = 16;
const CAP_DOWN = 11; // plume length cap (m)
const CAP_REAR = 15; // the rear boost plumes are long and horizontal
const GROUND_RANGE = 16; // the ground cloud forms when the plume hits the ground within this distance

export interface ThrusterInput {
  model: CarModel;
  carMatrix: THREE.Matrix4; // car group's matrixWorld
  vx: number; vy: number; vz: number; // car velocity
  down: number; // effective downward thrust 0..1 (thrusters, landing burn, assist)
  boost: number; // 0..1
  rcs: Float32Array; // 4 pulse levels
  suction: number; // 0..1 effective suction fans (dust is drawn in at the side skirts)
}

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _one = new THREE.Vector3(1, 1, 1);
const _dn = new THREE.Vector3(0, -1, 0);
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function plumeMaterial(core: boolean, noise: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    defines: { RADIUS_SCALE: core ? '0.45' : '1.0' },
    uniforms: {
      uNoise: { value: noise }, uTime: { value: 0 },
      uColor: { value: core ? new THREE.Color(1.0, 1.0, 1.0) : new THREE.Color(0.36, 0.72, 1.0) },
      uPow: { value: core ? 1.5 : 0.9 }, uGain: { value: core ? 2.1 : 1.35 },
    },
    vertexShader: `
      attribute vec4 iPlume; attribute float iSeed;
      varying float vV; varying float vAng; varying float vInt; varying vec3 vN; varying vec3 vView; varying float vSeed;
      void main() {
        float v = -position.y;
        float r = mix(iPlume.z, iPlume.w, pow(v, 0.75)) * RADIUS_SCALE;
        vec3 p = vec3(position.x * r, -v * iPlume.y, position.z * r);
        vec3 nObj = normalize(vec3(position.x, 0.2, position.z));
        vec4 mv = viewMatrix * modelMatrix * instanceMatrix * vec4(p, 1.0);
        vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * nObj);
        vView = normalize(-mv.xyz);
        vV = v; vAng = atan(position.z, position.x); vInt = iPlume.x; vSeed = iSeed;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uColor; uniform float uPow; uniform float uGain;
      varying float vV; varying float vAng; varying float vInt; varying vec3 vN; varying vec3 vView; varying float vSeed;
      void main() {
        if (vInt < 0.003) discard;
        float edge = pow(clamp(abs(dot(normalize(vN), normalize(vView))), 0.0, 1.0), 1.25);
        float n1 = texture2D(uNoise, vec2(vAng * 0.8 + vSeed, vV * 2.6 - uTime * 2.4)).r;
        float n2 = texture2D(uNoise, vec2(vAng * 1.7 - vSeed, vV * 5.0 - uTime * 4.6)).r;
        float flick = 0.8 + 0.2 * sin(uTime * 41.0 + vSeed * 40.0) * sin(uTime * 23.0 + vSeed * 9.0);
        float turb = mix(0.5, 1.0, n1 * 0.6 + n2 * 0.4);
        float fall = pow(clamp(1.0 - vV, 0.0, 1.0), uPow);
        float diamonds = 0.84 + 0.16 * sin(vV * 46.0 - uTime * 7.0);
        float hot = pow(clamp(1.0 - vV * 3.4, 0.0, 1.0), 2.0);
        float I = vInt * fall * turb * flick * diamonds * edge * smoothstep(0.0, 0.012, vV);
        gl_FragColor = vec4(uColor * (1.0 + hot * 1.6) * I * uGain, 1.0);
      }`,
  });
}

export class Thrusters {
  readonly group = new THREE.Group();
  private core: THREE.InstancedMesh;
  private sheath: THREE.InstancedMesh;
  private plumeAttr: THREE.InstancedBufferAttribute;
  private seedAttr: THREE.InstancedBufferAttribute;
  private glare: THREE.InstancedMesh;
  private glarePos: THREE.InstancedBufferAttribute;
  private glareCol: THREE.InstancedBufferAttribute;
  private matCore: THREE.ShaderMaterial;
  private matSheath: THREE.ShaderMaterial;
  private acc = new Float32Array(16);
  private levels = new Float32Array(10);
  private rcsPhase = 0;
  /** Light intensity for the shader-side smoke lighting. */
  lightLevel = 0;
  readonly lightPos = new THREE.Vector3(0, -50, 0);

  constructor(private smoke: SmokeSystem, private light: THREE.PointLight) {
    const noise = makeNoiseTexture(128);
    const cone = new THREE.CylinderGeometry(1, 1, 1, 24, 10, true);
    cone.translate(0, -0.5, 0);
    const geo = cone;
    this.plumeAttr = new THREE.InstancedBufferAttribute(new Float32Array(N_PLUMES * 4), 4);
    this.seedAttr = new THREE.InstancedBufferAttribute(new Float32Array(N_PLUMES), 1);
    this.plumeAttr.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < N_PLUMES; i++) this.seedAttr.setX(i, rnd() * 10);
    geo.setAttribute('iPlume', this.plumeAttr);
    geo.setAttribute('iSeed', this.seedAttr);
    this.matCore = plumeMaterial(true, noise);
    this.matSheath = plumeMaterial(false, noise);
    this.sheath = new THREE.InstancedMesh(geo, this.matSheath, N_PLUMES);
    this.core = new THREE.InstancedMesh(geo, this.matCore, N_PLUMES);
    this.sheath.renderOrder = 8;
    this.core.renderOrder = 9;
    for (const m of [this.sheath, this.core]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
    }

    // glare sprites with a little horizontal lens streak
    const quad = new THREE.InstancedBufferGeometry();
    quad.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    quad.setIndex([0, 1, 2, 0, 2, 3]);
    this.glarePos = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLARE * 4), 4); // xyz + size
    this.glareCol = new THREE.InstancedBufferAttribute(new Float32Array(MAX_GLARE * 3), 3);
    this.glarePos.setUsage(THREE.DynamicDrawUsage);
    this.glareCol.setUsage(THREE.DynamicDrawUsage);
    quad.setAttribute('iPos', this.glarePos);
    quad.setAttribute('iCol', this.glareCol);
    quad.instanceCount = 0;
    const gm = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `
        attribute vec4 iPos; attribute vec3 iCol; varying vec2 vP; varying vec3 vC;
        void main() {
          vec4 mv = viewMatrix * vec4(iPos.xyz, 1.0);
          mv.xy += position.xy * iPos.w * vec2(1.0, 1.0);
          vP = position.xy; vC = iCol;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec2 vP; varying vec3 vC;
        void main() {
          float r = length(vP);
          float core = pow(max(0.0, 1.0 - r), 2.6);
          float streak = exp(-abs(vP.y) * 22.0) * exp(-abs(vP.x) * 2.2) * 0.45;
          float I = core + streak;
          gl_FragColor = vec4(vC * I, 1.0);
        }`,
    });
    this.glare = new THREE.Mesh(quad, gm) as unknown as THREE.InstancedMesh;
    this.glare.frustumCulled = false;
    this.glare.renderOrder = 10;
    this.group.add(this.glare);
  }

  /** Update plumes, glare, light, car glow and emit smoke. Call after the car's matrixWorld is current. */
  update(dt: number, time: number, o: ThrusterInput): void {
    this.matCore.uniforms.uTime.value = time;
    this.matSheath.uniforms.uTime.value = time;
    const model = o.model;
    const mw = o.carMatrix;
    const lv = this.levels;
    lv.fill(0);
    let glareN = 0;
    const gp = this.glarePos, gc = this.glareCol;
    const pa = this.plumeAttr;

    // --- downward plumes ---
    for (let i = 0; i < 4; i++) {
      const a = model.down[i];
      _o.copy(a.pos).applyMatrix4(mw);
      _d.copy(a.dir).transformDirection(mw);
      // slightly different power per nozzle: tiny asymmetry reads as life
      const level = o.down * (0.94 + 0.06 * Math.sin(time * 9 + i * 1.7));
      lv[i] = level;
      const hit = _d.y < -0.3 ? _o.y / -_d.y : Infinity;
      let len = hit < CAP_DOWN ? hit : _d.y < -0.3 ? CAP_DOWN : CAP_DOWN * 0.3;
      len *= 0.4 + 0.6 * level;
      this.writePlume(i, _o, _d, level, len, 0.06, 0.12 + 0.026 * len);
      if (level > 0.03) {
        gp.setXYZW(glareN, _o.x, _o.y - 0.03, _o.z, 0.34 + 0.55 * level);
        gc.setXYZ(glareN, 0.55 * level, 0.85 * level, 1.15 * level);
        glareN++;
      }
      if (level > 0.05) this.emitDown(i, dt, _o, _d, level, hit, o);
    }

    // --- rear boost plumes ---
    for (let i = 0; i < 2; i++) {
      const a = model.rear[i];
      _o.copy(a.pos).applyMatrix4(mw);
      _d.copy(a.dir).transformDirection(mw);
      const level = o.boost;
      lv[4 + i] = level;
      this.writePlume(4 + i, _o, _d, level * 1.7, CAP_REAR * (0.3 + 0.7 * level), 0.1, 0.46);
      if (level > 0.03) {
        gp.setXYZW(glareN, _o.x, _o.y, _o.z + 0.05, 0.7 + 1.3 * level);
        gc.setXYZ(glareN, 0.9 * level, 1.3 * level, 1.7 * level);
        glareN++;
      }
      if (level > 0.08) {
        this.acc[8 + i] += 170 * level * dt;
        while (this.acc[8 + i] >= 1) {
          this.acc[8 + i] -= 1;
          const t0 = rnd() * 0.6;
          this.smoke.spawn(
            _o.x + _d.x * t0 + rndSigned() * 0.04, _o.y + _d.y * t0 + rndSigned() * 0.04, _o.z + _d.z * t0,
            o.vx + _d.x * 13 + rndSigned() * 0.8, o.vy + rndSigned() * 0.6 + 0.2, o.vz + _d.z * 13 + rndSigned() * 0.8,
            0.24, 2.2, 1.5 + rnd() * 0.8, 0.5, 0.7, 0.25, rndSigned() * 0.4, 0.8,
          );
        }
      }
    }

    // --- RCS puffs (sideways) ---
    for (let i = 0; i < 4; i++) {
      const a = model.rcs[i];
      const level = o.rcs[i];
      lv[6 + i] = level;
      if (level < 0.15) continue;
      _o.copy(a.pos).applyMatrix4(mw);
      _d.copy(a.dir).transformDirection(mw);
      if (glareN < MAX_GLARE) {
        gp.setXYZW(glareN, _o.x, _o.y, _o.z, 0.28 + 0.4 * level);
        gc.setXYZ(glareN, 0.9 * level, 1.1 * level, 1.4 * level);
        glareN++;
      }
      this.acc[10 + i] += 95 * level * dt;
      while (this.acc[10 + i] >= 1) {
        this.acc[10 + i] -= 1;
        this.smoke.spawn(
          _o.x, _o.y, _o.z,
          o.vx + _d.x * (7 + rnd() * 3) + rndSigned() * 0.6, o.vy + rndSigned() * 0.8, o.vz + _d.z * 7 + rndSigned() * 0.6,
          0.09, 0.85, 0.5 + rnd() * 0.3, 0.46, 1.4, 0.1, rndSigned() * 0.8, 0.9,
        );
      }
    }

    // --- suction fans: small air/dust streaks drawn in at the side skirts ---
    if (o.suction > 0.35) {
      this.acc[14] += 90 * o.suction * dt;
      while (this.acc[14] >= 1) {
        this.acc[14] -= 1;
        const side = rnd() < 0.5 ? -1 : 1;
        _o.set(side * 1.08, 0.1 + rnd() * 0.08, (rnd() - 0.5) * 3.6).applyMatrix4(mw);
        _d.set(-side, -0.05, 0).transformDirection(mw);
        this.smoke.spawn(
          _o.x + _d.x * 0.5, _o.y, _o.z + _d.z * 0.5, _d.x * 3.2 + rndSigned() * 0.4, _d.y * 3.2, _d.z * 3.2 + rndSigned() * 0.4,
          0.05, 0.3, 0.45, 0.3, 1.1, 0, rndSigned() * 0.5, 0.2,
        );
      }
    }

    // unused plume slots shrink to nothing
    pa.needsUpdate = true;
    this.core.instanceMatrix.needsUpdate = true;
    this.sheath.instanceMatrix.needsUpdate = true;
    (this.glare.geometry as THREE.InstancedBufferGeometry).instanceCount = glareN;
    gp.needsUpdate = true;
    gc.needsUpdate = true;

    // --- the cold-white light under the car follows thrust ---
    const level = Math.max(o.down, o.boost * 0.85);
    _o.set(0, 0.1, 0).applyMatrix4(mw);
    this.lightPos.set(_o.x, Math.max(_o.y, 0.55), _o.z);
    this.light.position.copy(this.lightPos);
    this.light.intensity = 170 * level * (0.94 + 0.06 * Math.sin(time * 37));
    this.lightLevel = level;

    model.setNozzleGlow(lv);
    model.setUnderGlow(o.down);
  }

  private writePlume(i: number, o: THREE.Vector3, d: THREE.Vector3, level: number, len: number, r0: number, r1: number): void {
    _q.setFromUnitVectors(_dn, d);
    _m.compose(o, _q, _one);
    this.core.setMatrixAt(i, _m);
    this.sheath.setMatrixAt(i, _m);
    this.plumeAttr.setXYZW(i, level > 0.02 ? level : 0, len, r0, r1);
  }

  /** Smoke from one downward nozzle: the column, and the ground cloud when it hits the road. */
  private emitDown(i: number, dt: number, o: THREE.Vector3, d: THREE.Vector3, level: number, hit: number, inp: ThrusterInput): void {
    const smoke = this.smoke;
    // the column of condensate leaving the nozzle (it trails downward in the air)
    this.acc[i] += 88 * level * dt;
    while (this.acc[i] >= 1) {
      this.acc[i] -= 1;
      const t0 = rnd() * 0.45;
      const speed = 16 + rnd() * 7;
      const finite = hit < 60;
      const life = finite ? Math.min(0.85, Math.max(0.14, (hit / speed) * 0.9)) : 0.9 + rnd() * 0.6;
      const s1 = finite ? 0.7 + 0.1 * hit : 1.8 + rnd() * 0.8;
      smoke.spawn(
        o.x + d.x * t0 + rndSigned() * 0.05, o.y + d.y * t0, o.z + d.z * t0 + rndSigned() * 0.05,
        d.x * speed + inp.vx * 0.15 + rndSigned() * 0.7, d.y * speed + rndSigned() * 0.5, d.z * speed + inp.vz * 0.15 + rndSigned() * 0.7,
        0.13, s1, life, 0.42, 0.35, 0, 0, 1.0,
      );
    }
    // where the plume hits the road, the smoke spreads sideways into big rolling clouds
    if (hit < GROUND_RANGE) {
      const prox = smoothstep(GROUND_RANGE, 3, hit);
      this.acc[4 + i] += 74 * level * (0.35 + 0.65 * prox) * dt;
      const hx = o.x + d.x * hit, hz = o.z + d.z * hit;
      while (this.acc[4 + i] >= 1) {
        this.acc[4 + i] -= 1;
        const ang = rnd() * 6.2832;
        const sp = 3.8 + rnd() * 7.5;
        const r = rnd() * 0.9;
        smoke.spawn(
          hx + Math.cos(ang) * r, 0.25 + rnd() * 0.5, hz + Math.sin(ang) * r,
          Math.cos(ang) * sp + inp.vx * 0.22, 0.5 + rnd() * 1.1, Math.sin(ang) * sp + inp.vz * 0.22,
          0.5 + rnd() * 0.3, 2.5 + rnd() * 1.6, 3.0 + rnd() * 2.6, 0.34 + rnd() * 0.1,
          1.5 + rnd() * 0.6, 0.28, rndSigned() * 0.9, 0.35,
        );
      }
    }
  }

  /** The giant landing cloud (v1): a ring of fast low puffs plus billowing columns. */
  landingBurst(x: number, z: number, strength: number): void {
    const n = Math.floor(90 + 110 * strength);
    for (let k = 0; k < n; k++) {
      const ang = rnd() * 6.2832;
      const sp = 5 + rnd() * 11;
      const r = rnd() * 1.6;
      this.smoke.spawn(
        x + Math.cos(ang) * r, 0.3 + rnd() * 0.9, z + Math.sin(ang) * r,
        Math.cos(ang) * sp, 0.6 + rnd() * 2.2, Math.sin(ang) * sp,
        0.7 + rnd() * 0.5, 3.0 + rnd() * 2.0, 3.4 + rnd() * 2.6, 0.42 + rnd() * 0.12,
        1.35 + rnd() * 0.5, 0.35, rndSigned() * 1.0, 0.3,
      );
    }
  }

  /** A short burst of puffs where the boom snaps, sparks for crashes etc. can reuse this. */
  puffAt(x: number, y: number, z: number, n: number, speed: number): void {
    for (let k = 0; k < n; k++) {
      const a = rnd() * 6.2832, e = rnd() * 1.2;
      this.smoke.spawn(x, y, z, Math.cos(a) * speed * rnd(), 1 + Math.sin(e) * speed * 0.5, Math.sin(a) * speed * rnd(),
        0.2, 1.6, 0.9 + rnd() * 0.7, 0.4, 1.8, 0.2, rndSigned(), 0);
    }
  }

  reset(): void {
    this.acc.fill(0);
    this.light.intensity = 0;
    (this.glare.geometry as THREE.InstancedBufferGeometry).instanceCount = 0;
    for (let i = 0; i < N_PLUMES; i++) this.plumeAttr.setXYZW(i, 0, 0, 0.05, 0.1);
    this.plumeAttr.needsUpdate = true;
    this.rcsPhase = 0;
  }
}
