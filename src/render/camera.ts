// Camera rig: frame-rate independent spring chase camera (1 - exp(-k dt)), a wall camera, an arena stunt camera
// (a side view that frames the whole flip and descent), a side cinematic, a drone aerial, the start-screen studio
// orbit, a manual pose for scripted shots, and trauma-based shake. Heading aware: after the stunt flip the car faces +Z.
import * as THREE from 'three';
import { CAMERA, PHYS } from '../config';
import type { VehicleState } from '../sim/vehicle';
import { fitFov, lookAhead, pullBack, raise } from './fov';

export type CamMode = 'chase' | 'side' | 'drone' | 'manual';
export const CAM_MODES: CamMode[] = ['chase', 'side', 'drone'];

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const sm = (k: number, dt: number) => 1 - Math.exp(-k * dt);
const noise = (t: number, s: number) =>
  Math.sin(t * 17 + s) * 0.5 + Math.sin(t * 31.7 + s * 1.7) * 0.3 + Math.sin(t * 53.1 + s * 2.3) * 0.2;

/** Where the studio camera sits to match refs/roadster.png: low, rear-left three-quarter, telephoto. */
export const STUDIO_AZIMUTH = (55 * Math.PI) / 180;

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  mode: CamMode = 'chase';
  trauma = 0;
  private air = 0;
  private wallBlend = 0;
  private stuntBlend = 0;
  private fov = CAMERA.fovMin;
  private roll = 0;
  private time = 0;
  private readonly pos = new THREE.Vector3(0, 3, 8); // spring state (never contains the shake)
  private readonly look = new THREE.Vector3();
  private readonly tgt = new THREE.Vector3();
  private readonly tl = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly fwd = new THREE.Vector3(0, 0, -1);
  private readonly wp = new THREE.Vector3();
  private readonly wl = new THREE.Vector3();
  private readonly sp = new THREE.Vector3();
  private readonly sl = new THREE.Vector3();
  private manualFov = 60;
  private aspect: number;

  constructor(aspect: number) {
    this.aspect = aspect;
    this.camera = new THREE.PerspectiveCamera(fitFov(CAMERA.fovMin, aspect), aspect, 0.3, 1400);
    this.camera.position.set(0, 3, 8);
  }

  setAspect(a: number): void {
    this.aspect = a;
    this.camera.aspect = a;
    if (this.mode !== 'manual') this.camera.fov = fitFov(this.fov, a); // a turned phone is right before the next frame, not after it
    this.camera.updateProjectionMatrix();
  }

  addTrauma(a: number): void {
    this.trauma = Math.min(1, this.trauma + a);
  }

  setMode(m: CamMode): void {
    this.mode = m;
  }

  /** Fixed pose, for scripted shots. */
  setManual(px: number, py: number, pz: number, lx: number, ly: number, lz: number, fov = 60): void {
    this.mode = 'manual';
    this.manualFov = fov;
    this.pos.set(px, py, pz);
    this.look.set(lx, ly, lz);
    this.camera.position.copy(this.pos);
    this.camera.up.set(0, 1, 0);
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.look);
  }

  cycle(): CamMode {
    const i = CAM_MODES.indexOf(this.mode);
    this.mode = CAM_MODES[(i + 1) % CAM_MODES.length];
    return this.mode;
  }

  /** The camera of a fresh run: chase mode and nothing left over (zoom, tilt, shake, springs) from the last one. */
  reset(v: VehicleState): void {
    this.mode = 'chase';
    this.trauma = 0;
    this.roll = 0;
    this.time = 0;
    this.fov = CAMERA.fovMin;
    this.camera.fov = fitFov(CAMERA.fovMin, this.aspect);
    this.camera.updateProjectionMatrix();
    this.camera.up.set(0, 1, 0);
    this.snap(v);
  }

  /** Jump straight to the gameplay pose (no spring), e.g. at the start of a run or after a teleport. */
  snap(v: VehicleState): void {
    this.air = 0;
    this.wallBlend = 0;
    this.stuntBlend = 0;
    if (this.mode === 'manual') this.mode = 'chase';
    this.compute(v, 0);
    this.pos.copy(this.tgt);
    this.camera.position.copy(this.tgt);
    this.look.copy(this.tl);
    this.camera.lookAt(this.look);
  }

  private compute(v: VehicleState, f: number): void {
    const sp = clamp(f / PHYS.topSpeed, 0, 1);
    const t = this.time;
    const d = v.dir;
    switch (this.mode) {
      case 'chase': {
        // a tall screen raises the camera and looks nearer the car on the road, not in the air (the wall and stunt views
        // below replace the pose, and take the lift with it)
        const road = 1 - this.air;
        const dist = lerp(CAMERA.distGround, CAMERA.distAir, this.air) + sp * 1.4;
        const h = lerp(CAMERA.heightGround, CAMERA.heightAir, this.air) + Math.min(v.y, 30) * 0.1 + raise(this.aspect) * road;
        this.tgt.set(v.x * 0.8, v.y * 0.55 + h, v.z + dist * d);
        this.tl.set(v.x * 0.9, v.y * 0.6 + 1.0, v.z - (9.5 + sp * 6) * lerp(1, lookAhead(this.aspect), road) * d);
        if (this.wallBlend > 0.01) {
          // look at the wall face from the open side, a little off to the right
          this.tgt.lerp(this.wp.set(v.x + 4.5, Math.max(2.4, v.y + 2.6), v.z + 11.5), this.wallBlend);
          this.tl.lerp(this.wl.set(v.x, v.y + 0.8, v.z - 0.5), this.wallBlend);
        }
        if (this.stuntBlend > 0.01) {
          // the stunt: a side view that keeps the wall, the flip and the descent in frame
          this.tgt.lerp(this.sp.set(v.x + 24, 6 + v.y * 0.4, v.z + 16), this.stuntBlend);
          this.tl.lerp(this.sl.set(v.x, 3 + v.y * 0.65, v.z - 2), this.stuntBlend);
        }
        break;
      }
      case 'side':
        this.tgt.set(v.x + 9.5, 1.7 + v.y * 0.5, v.z + (2.2 + f * 0.04) * d);
        this.tl.set(v.x, 0.8 + v.y * 0.6, v.z - 1.2 * d);
        break;
      case 'drone':
        this.tgt.set(v.x + 11 + 6 * Math.sin(t * 0.15), 24 + v.y * 0.5, v.z + (19 + 6 * Math.cos(t * 0.12)) * d);
        this.tl.set(v.x, v.y * 0.7, v.z - 6 * d);
        break;
      default:
        break;
    }
    // a screen held upright is narrow: back off along the line of sight (the look point stays) so more of the road fits
    const pull = pullBack(this.aspect);
    if (pull !== 1) this.tgt.sub(this.tl).multiplyScalar(pull).add(this.tl);
  }

  /** Gameplay update. stunt: the arena stunt is under way (flip, hover, descent). */
  update(dt: number, v: VehicleState, forwardSpeed: number, boostLevel: number, thrust01 = 0, stunt = false): void {
    this.time += dt;
    if (this.mode === 'manual') return;
    const f = Math.max(0, forwardSpeed);
    const sp = clamp(f / PHYS.topSpeed, 0, 1);
    const airT = v.mode === 'wall' ? 0 : Math.max(clamp((v.y - 1.5) / 7, 0, 1), clamp(thrust01 * 1.1, 0, 1));
    this.air += (airT - this.air) * sm(2.2, dt);
    this.wallBlend += ((v.mode === 'wall' ? 1 : 0) - this.wallBlend) * sm(3.5, dt);
    this.stuntBlend += ((stunt ? 1 : 0) - this.stuntBlend) * sm(2.6, dt);
    this.compute(v, f);

    const cam = this.camera;
    const p = this.pos;
    if (this.mode === 'chase') {
      const sb = this.stuntBlend;
      p.x += (this.tgt.x - p.x) * sm(lerp(5.5, 3.2, sb), dt);
      p.y += (this.tgt.y - p.y) * sm(lerp(4.5, 3, sb), dt);
      p.z += (this.tgt.z - p.z) * sm(lerp(18, 4.5, sb), dt);
    } else if (this.mode === 'side') {
      p.x += (this.tgt.x - p.x) * sm(6, dt);
      p.y += (this.tgt.y - p.y) * sm(4, dt);
      p.z += (this.tgt.z - p.z) * sm(5, dt);
    } else {
      p.x += (this.tgt.x - p.x) * sm(2.2, dt);
      p.y += (this.tgt.y - p.y) * sm(2.2, dt);
      p.z += (this.tgt.z - p.z) * sm(7, dt);
    }
    this.look.x += (this.tl.x - this.look.x) * sm(10, dt);
    this.look.y += (this.tl.y - this.look.y) * sm(10, dt);
    this.look.z += (this.tl.z - this.look.z) * sm(12, dt);

    // fov widens with speed, kicks hard on boost; the stunt view is a little tighter
    const fovT = this.mode === 'drone' ? 52 : this.mode === 'side' ? 46
      : lerp(lerp(CAMERA.fovMin, CAMERA.fovMax, Math.pow(sp, 1.1)) + CAMERA.boostKick * boostLevel, 46, this.stuntBlend);
    this.fov += (fovT - this.fov) * sm(4, dt);
    cam.fov = fitFov(this.fov, this.aspect); // this.fov is the landscape design value; a tall screen widens it
    cam.updateProjectionMatrix();

    // a little shake while the rear boost roars; trauma-based shake otherwise (a pure offset on the final pose)
    if (boostLevel > 0.3) this.trauma = Math.max(this.trauma, 0.1 * boostLevel);
    this.trauma = Math.max(0, this.trauma - dt * 1.25);
    const sh = this.trauma * this.trauma;
    const tt = this.time;
    const rollT = -v.steer * 0.035 * (this.mode === 'chase' ? 1 : 0.3) * (1 - this.stuntBlend) + noise(tt, 3.7) * sh * 0.05;
    this.roll += (rollT - this.roll) * sm(8, dt);
    cam.position.set(p.x + noise(tt, 1.3) * sh * 0.45, p.y + noise(tt, 7.1) * sh * 0.35, p.z);
    cam.up.set(0, 1, 0).applyAxisAngle(this.fwd, this.roll);
    cam.lookAt(this.look);
  }

  /** Start-screen orbit around the car, matching the studio reference. t in seconds; azimuth 0 = from the rear. */
  studio(t: number, frozen = false): void {
    const a = STUDIO_AZIMUTH + (frozen ? 0 : t * 0.1);
    const R = 8.7 * pullBack(this.aspect);
    const cam = this.camera;
    cam.position.set(-Math.sin(a) * R, 1.18, Math.cos(a) * R);
    cam.up.set(0, 1, 0);
    cam.fov = fitFov(28, this.aspect);
    cam.updateProjectionMatrix();
    cam.lookAt(0.05, 0.62, 0);
  }

  get manual(): number { return this.manualFov; }
}
