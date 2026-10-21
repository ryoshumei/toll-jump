import { describe, expect, it } from 'vitest';
import { CAMERA, KMH, PHYS, PLAZA } from '../config';
import { START_SPEED } from '../sim/run';
import { createVehicle } from '../sim/vehicle';
import { CameraRig, type CamMode } from './camera';
import { fitFov, MAX_VFOV, pullBack } from './fov';

const startCar = () => { const v = createVehicle(); v.vz = -START_SPEED; return v; };

/** Everything the rig remembers between frames, private springs included. */
const memory = (r: CameraRig) => ({
  mode: r.mode, trauma: r.trauma, fov: r.camera.fov, pos: r.camera.position.toArray(), quat: r.camera.quaternion.toArray(), up: r.camera.up.toArray(),
  air: r['air'], wallBlend: r['wallBlend'], stuntBlend: r['stuntBlend'], springFov: r['fov'], roll: r['roll'], time: r['time'],
  spring: r['pos'].toArray(), look: r['look'].toArray(),
});

describe('the chase camera after a restart', () => {
  it('is the same as the camera of a fresh start, with no zoom, tilt or shake left over from a fast run', () => {
    const fresh = new CameraRig(16 / 9);
    fresh.reset(startCar());

    const used = new CameraRig(16 / 9);
    const v = createVehicle();
    v.z = -4000; v.vz = -PHYS.topSpeed; v.y = 18; v.grounded = false; v.steer = 1; v.x = 5;
    for (let i = 0; i < 300; i++) { v.z += v.vz / 60; used.addTrauma(0.05); used.update(1 / 60, v, PHYS.topSpeed, 1, 1, false); }
    expect(used.camera.fov).toBeGreaterThan(fresh.camera.fov + 5); // really zoomed out by speed and boost before the restart
    expect(used.camera.position.z).toBeLessThan(-3000);
    used.cycle(); // and the player had switched to another view

    used.reset(startCar());
    expect(memory(used)).toEqual(memory(fresh));
  });

  it('starts behind the car at the origin', () => {
    const rig = new CameraRig(16 / 9);
    rig.reset(startCar());
    expect(rig.camera.position.z).toBeGreaterThan(0);
    expect(Math.abs(rig.camera.position.z)).toBeLessThan(20);
    expect(START_SPEED).toBeCloseTo(35 * KMH, 9);
  });
});

describe('the chase camera on a landscape screen', () => {
  it('sits exactly where it was tuned: 7.2 m behind the car and 2.55 m up, looking 9.5 m ahead, at a 60 degree FOV', () => {
    for (const aspect of [16 / 9, 844 / 390, 1]) {
      const rig = new CameraRig(aspect);
      rig.reset(startCar());
      expect(rig.camera.position.toArray()).toEqual([0, 2.55, 7.2]);
      expect(rig['look'].toArray()).toEqual([0, 1, -9.5]);
      expect(rig.camera.fov).toBe(60);
    }
  });
});

const PHONE = 390 / 844; // an iPhone held upright

/** A rig driven at 160 km/h for two seconds in the given view, in the given screen shape (thrust 1: thrusters on, so airborne). */
const driven = (aspect: number, mode: CamMode, boost: number, stunt: boolean, thrust = 0) => {
  const rig = new CameraRig(aspect);
  const v = startCar();
  rig.reset(v);
  rig.setMode(mode);
  for (let i = 0; i < 120; i++) { v.z -= (160 * KMH) / 60; rig.update(1 / 60, v, 160 * KMH, boost, thrust, stunt); }
  return rig;
};

describe('the camera on a screen held upright', () => {
  // 0.75 (an iPad held upright) as well as a phone: at 390/844 every chase FOV from about 49 degrees up is clamped to the fisheye
  // limit, which would hide a rig that ignored speed and boost
  it('fits the FOV to the screen on top of every FOV the rig animates (speed, boost kick, stunt view, side and drone views)', () => {
    for (const aspect of [PHONE, 0.75]) {
      for (const mode of ['chase', 'side', 'drone'] as const) {
        for (const [boost, stunt] of [[0, false], [1, false], [0, true]] as const) {
          const landscape = driven(16 / 9, mode, boost, stunt);
          const upright = driven(aspect, mode, boost, stunt);
          expect(upright.camera.fov, `${aspect} ${mode} boost ${boost} stunt ${stunt}`).toBeCloseTo(fitFov(landscape.camera.fov, aspect), 6);
          expect(upright.camera.fov).toBeGreaterThan(landscape.camera.fov);
          expect(upright.camera.aspect).toBeCloseTo(aspect, 9);
        }
      }
    }
  });

  it('lets speed and the boost kick show through where the fisheye limit does not clamp them (0.75: the 60 degree rest FOV is 75.2, the boosted top speed 91.3)', () => {
    const rest = new CameraRig(0.75);
    rest.reset(startCar());
    expect(rest.camera.fov).toBeCloseTo(75.18, 1);
    const cruising = driven(0.75, 'chase', 0, false); // 160 km/h
    const boosted = driven(0.75, 'chase', 1, false); // and the kick on top
    expect(cruising.camera.fov).toBeGreaterThan(rest.camera.fov + 4); // the speed widening is there
    expect(boosted.camera.fov).toBeGreaterThan(cruising.camera.fov + 8); // and so is the boost kick
    expect(boosted.camera.fov).toBeLessThan(MAX_VFOV); // still short of the limit, so none of it was flattened
  });

  it('fits the start-screen studio shot too: a wider telephoto, and an orbit that backs off', () => {
    const landscape = new CameraRig(16 / 9);
    landscape.studio(0, true);
    const upright = new CameraRig(PHONE);
    upright.studio(0, true);
    expect(landscape.camera.fov).toBe(28);
    expect(upright.camera.fov).toBeCloseTo(fitFov(28, PHONE), 6);
    const radius = (r: CameraRig) => Math.hypot(r.camera.position.x, r.camera.position.z);
    expect(radius(upright) / radius(landscape)).toBeCloseTo(pullBack(PHONE), 6);
  });

  it('has the fitted FOV from the very first frame: when it is created and after a restart', () => {
    for (const aspect of [PHONE, 0.75]) {
      const rig = new CameraRig(aspect);
      expect(rig.camera.fov).toBeCloseTo(fitFov(CAMERA.fovMin, aspect), 6);
      rig.camera.fov = 90; // whatever a used rig had
      rig.reset(startCar());
      expect(rig.camera.fov).toBeCloseTo(fitFov(CAMERA.fovMin, aspect), 6);
    }
  });

  it('refits at once when the phone is turned, and turning it back leaves nothing behind', () => {
    const rig = driven(16 / 9, 'chase', 1, false); // zoomed out by speed and the boost kick
    const landscapeFov = rig.camera.fov;
    expect(landscapeFov).toBeGreaterThan(CAMERA.fovMax);
    rig.setAspect(PHONE);
    expect(rig.camera.fov).toBeCloseTo(fitFov(landscapeFov, PHONE), 6);
    rig.setAspect(16 / 9);
    expect(rig.camera.fov).toBeCloseTo(landscapeFov, 9);
  });

  it('leaves a scripted manual pose exactly as asked', () => {
    const rig = new CameraRig(16 / 9);
    rig.setManual(0, 3, 8, 0, 1, 0, 40);
    rig.setAspect(PHONE);
    expect(rig.camera.fov).toBe(40);
  });

  it('backs the side and drone cameras off along their line of sight, without changing where they look', () => {
    for (const mode of ['side', 'drone'] as const) {
      const pose = (aspect: number) => {
        const rig = new CameraRig(aspect);
        const v = startCar();
        rig.reset(v);
        rig.setMode(mode);
        rig.snap(v);
        return rig;
      };
      const landscape = pose(16 / 9);
      const upright = pose(PHONE);
      expect(upright['look'].toArray()).toEqual(landscape['look'].toArray());
      const away = (r: CameraRig) => r.camera.position.distanceTo(r['look']);
      expect(away(upright) / away(landscape)).toBeCloseTo(pullBack(PHONE), 6);
    }
  });

  it('lifts the road camera and points it nearer the car, on the plain road view only', () => {
    const lift = (thrust: number, stunt: boolean) =>
      driven(PHONE, 'chase', 0, stunt, thrust).camera.position.y - driven(16 / 9, 'chase', 0, stunt, thrust).camera.position.y;
    expect(lift(0, false)).toBeGreaterThan(0.8); // on the road: up by a metre or so
    expect(lift(1, false)).toBeLessThan(1.5); // airborne the camera is high already: only the pull-back
    expect(lift(0, true)).toBeLessThan(1.5); // the stunt view: likewise
    const lookZ = (aspect: number) => driven(aspect, 'chase', 0, false)['look'].z; // the car drives toward -z
    expect(lookZ(PHONE) - lookZ(16 / 9)).toBeGreaterThan(3); // the look point is nearer the car
  });

  it('keeps the road camera low enough to drive under a toll canopy (its fascia hangs from PLAZA.valanceBottom)', () => {
    for (const aspect of [PHONE, 360 / 740, 430 / 932, 390 / 664, 0.4]) {
      for (const [boost, thrust] of [[0, 0], [1, 0]] as const) {
        const rig = driven(aspect, 'chase', boost, false, thrust);
        expect(rig.camera.position.y).toBeLessThan(PLAZA.valanceBottom - 0.4); // room for the shake and the near plane
      }
    }
  });
});
