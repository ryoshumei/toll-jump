import { describe, expect, it } from 'vitest';
import { KMH, PHYS } from '../config';
import { START_SPEED } from '../sim/run';
import { createVehicle } from '../sim/vehicle';
import { CameraRig } from './camera';

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
