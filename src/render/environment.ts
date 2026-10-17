// Night environment: lights, sky, stars, moon, hills, city glow, the PMREM "night studio" env map, and the
// start-screen studio set.
import * as THREE from 'three';
import { makeGlowTexture, makePoolTexture } from './textures';

export const FOG_COLOR = 0x090c12;
export const FOG_DENSITY = 0.0042;
/** Direction from the car toward the moon (ahead, left, 25 degrees up): a low raking key light. */
export const MOON_DIR = new THREE.Vector3(-0.45, 0.42, -0.78).normalize();

/** The PMREM env map, assigned per material (scene.environment would ignore each material's envMapIntensity). */
export const shared: { env: THREE.Texture | null } = { env: null };

export interface Lights {
  hemi: THREE.HemisphereLight;
  moon: THREE.DirectionalLight;
  thruster: THREE.PointLight;
}

export function createLights(scene: THREE.Scene, shadowSize: number): Lights {
  const hemi = new THREE.HemisphereLight(0x2c3d6e, 0x0a0c10, 0.3);
  scene.add(hemi);
  const moon = new THREE.DirectionalLight(0xb4caff, 0.6);
  moon.castShadow = true;
  moon.shadow.mapSize.set(shadowSize, shadowSize);
  const sc = moon.shadow.camera;
  sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
  sc.near = 1; sc.far = 150;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.035;
  scene.add(moon);
  scene.add(moon.target);
  // cold-white light under the car; intensity follows thrust
  const thruster = new THREE.PointLight(0xd4e8ff, 0, 34, 2);
  scene.add(thruster);
  return { hemi, moon, thruster };
}

const SHADOW_HALF = 17;
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _t = new THREE.Vector3();

/** Move the moon light with the car, snapping its target to shadow-texel steps so shadows never shimmer. */
export function followMoon(moon: THREE.DirectionalLight, x: number, y: number, z: number, dirOverride?: THREE.Vector3): void {
  const dir = dirOverride ?? MOON_DIR;
  _r.set(0, 1, 0).cross(dir).normalize(); // light-space right
  _u.copy(dir).cross(_r).normalize(); // light-space up
  const texel = (SHADOW_HALF * 2) / moon.shadow.mapSize.x;
  _t.set(x, Math.max(0, y * 0.5), z);
  const a = Math.round(_t.dot(_r) / texel) * texel;
  const b = Math.round(_t.dot(_u) / texel) * texel;
  const c = _t.dot(dir);
  _t.copy(_r).multiplyScalar(a).addScaledVector(_u, b).addScaledVector(dir, c);
  moon.target.position.copy(_t);
  moon.position.copy(_t).addScaledVector(dir, 70);
  moon.target.updateMatrixWorld();
}

// ---------------- sky ----------------
export interface Sky {
  group: THREE.Group;
  update(camPos: THREE.Vector3): void;
}

export function createSky(): Sky {
  const group = new THREE.Group();

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 20),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0.0025, 0.005, 0.0145) },
        uHorizon: { value: new THREE.Color(0.012, 0.014, 0.02) },
        uGlow: { value: new THREE.Color(0.03, 0.019, 0.012) },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `
        varying vec3 vDir; uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uGlow;
        void main(){
          float h = vDir.y;
          vec3 col = mix(uHorizon, uZenith, pow(clamp(h,0.0,1.0), 0.42));
          float az = atan(vDir.x, -vDir.z);
          float cg = exp(-abs(h) * 11.0) * (0.5 + 0.5 * cos(az * 1.0) + 0.18 * cos(az * 3.0 + 1.3));
          col += uGlow * max(cg, 0.0);
          col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.18, h));
          gl_FragColor = vec4(col, 1.0);
        }`,
    }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  group.add(dome);

  // stars
  const N = 1500;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < N; i++) {
    const y = 0.03 + rnd() * 0.97;
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    pos[i * 3] = Math.cos(a) * r * 860;
    pos[i * 3 + 1] = y * 860;
    pos[i * 3 + 2] = Math.sin(a) * r * 860;
    const b = 0.35 + Math.pow(rnd(), 4) * 1.5;
    const tint = rnd();
    col[i * 3] = b * (tint > 0.8 ? 1.0 : 0.85);
    col[i * 3 + 1] = b * 0.92;
    col[i * 3 + 2] = b * (tint < 0.35 ? 1.1 : 0.9);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(sg, new THREE.PointsMaterial({
    size: 2.2, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false,
  }));
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  group.add(stars);

  // moon: a bright core with a soft halo, exactly where the key light comes from
  const glow = makeGlowTexture(128, 2.0);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: new THREE.Color(0.28, 0.34, 0.5), blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  halo.scale.setScalar(300);
  halo.position.copy(MOON_DIR).multiplyScalar(820);
  halo.renderOrder = -98;
  group.add(halo);
  const core = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glow, color: new THREE.Color(3.2, 3.4, 3.8), blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  }));
  core.scale.setScalar(34);
  core.position.copy(MOON_DIR).multiplyScalar(815);
  core.renderOrder = -97;
  group.add(core);

  // dark hill silhouette band, with a few distant lights
  const SEG = 160;
  const hp = new Float32Array((SEG + 1) * 2 * 3);
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const h = 16 + 22 * Math.sin(a * 3 + 0.7) * Math.sin(a * 5 + 2.1) + 14 * Math.sin(a * 11 + 0.3) + 7 * Math.sin(a * 23 + 4.0)
      + 18 * Math.max(0, Math.sin(a * 2 + 1.0));
    const R = 520;
    hp[i * 6] = Math.cos(a) * R; hp[i * 6 + 1] = -6; hp[i * 6 + 2] = Math.sin(a) * R;
    hp[i * 6 + 3] = Math.cos(a) * R; hp[i * 6 + 4] = Math.max(h, 6); hp[i * 6 + 5] = Math.sin(a) * R;
  }
  const hi: number[] = [];
  for (let i = 0; i < SEG; i++) { const k = i * 2; hi.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  hg.setIndex(hi);
  const hills = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: 0x03050a, side: THREE.DoubleSide, fog: false }));
  hills.renderOrder = -95;
  hills.frustumCulled = false;
  group.add(hills);

  const CL = 220;
  const cp = new Float32Array(CL * 3);
  const cc = new Float32Array(CL * 3);
  for (let i = 0; i < CL; i++) {
    const a = rnd() * Math.PI * 2;
    const R = 515;
    cp[i * 3] = Math.cos(a) * R; cp[i * 3 + 1] = 2 + rnd() * 9; cp[i * 3 + 2] = Math.sin(a) * R;
    const warm = rnd() > 0.35;
    const b = 0.7 + rnd() * 1.6;
    cc[i * 3] = b * (warm ? 1.0 : 0.7); cc[i * 3 + 1] = b * (warm ? 0.62 : 0.85); cc[i * 3 + 2] = b * (warm ? 0.3 : 1.0);
  }
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
  cg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  const lights = new THREE.Points(cg, new THREE.PointsMaterial({
    size: 2.0, sizeAttenuation: false, vertexColors: true, transparent: true, depthWrite: false, fog: false,
  }));
  lights.renderOrder = -94;
  lights.frustumCulled = false;
  group.add(lights);

  return {
    group,
    update(camPos) {
      group.position.set(camPos.x, 0, camPos.z);
    },
  };
}

// ---------------- env map ----------------
/** A small dark "night studio" (cool softbox, tall strip, red strip, warm back panel) for the reflections. */
export function createEnvMap(renderer: THREE.WebGLRenderer): THREE.Texture {
  const s = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(46, 22, 46), new THREE.MeshBasicMaterial({ color: 0x030406, side: THREE.BackSide }));
  s.add(room);
  const panel = (w: number, h: number, c: [number, number, number], x: number, y: number, z: number, rx = 0, ry = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(c[0], c[1], c[2]), side: THREE.DoubleSide }));
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, 0);
    s.add(m);
  };
  panel(16, 9, [5.0, 5.6, 6.6], 0, 10.2, -2, Math.PI / 2); // overhead cool softbox
  panel(2.4, 12, [7.0, 7.4, 8.2], -17, 3, 0, 0, Math.PI / 2); // tall strip, left
  panel(0.7, 16, [5.5, 0.16, 0.1], 17, 1.0, -5, 0, Math.PI / 2); // red strip, right
  panel(8, 2.5, [0.9, 0.85, 0.8], 0, 3, -20); // faint warm back panel
  panel(34, 5, [3.6, 4.0, 4.9], 0, 9.5, -21); // wide horizon strip ahead: what a chase camera's roof reflections land on
  panel(16, 4, [2.6, 2.9, 3.6], 0, 4, 21); // cool panel behind: gives the rear fascia a sheen
  panel(2.2, 8, [2.2, 2.4, 3.0], 17, 4, 8, 0, Math.PI / 2); // right strip, rear
  panel(30, 0.6, [0.9, 0.12, 0.09], 0, -3.5, -12); // red glow along the floor line
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(s, 0.035);
  pmrem.dispose();
  s.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) (m.material as THREE.Material).dispose();
  });
  shared.env = rt.texture;
  return rt.texture;
}

// ---------------- start-screen studio ----------------
export interface Studio {
  group: THREE.Group;
}

export function createStudio(): Studio {
  const group = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: 0x0b0c10, roughness: 0.5, metalness: 0.0, envMap: shared.env, envMapIntensity: 0.3 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  group.add(floor);

  const poolTex = makePoolTexture(128);
  const mk = (w: number, d: number, x: number, z: number, rot: number, c: THREE.Color) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshBasicMaterial({ map: poolTex, color: c, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    m.rotation.set(-Math.PI / 2, 0, rot);
    m.position.set(x, 0.004, z);
    group.add(m);
  };
  mk(11, 4.2, -4.4, -1.5, 0.18, new THREE.Color(0.62, 0.6, 0.57)); // the soft spotlight pool, front-left
  mk(16, 2.2, 8.5, 2.5, -0.06, new THREE.Color(0.2, 0.22, 0.26)); // faint far streak
  group.visible = false;
  return { group };
}
