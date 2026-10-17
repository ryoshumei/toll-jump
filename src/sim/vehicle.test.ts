import { describe, expect, it } from 'vitest';
import { G0, KMH, PHYS } from '../config';
import {
  applyBoomHit, applyCrash, createEvents, createInput, createVehicle, forwardSpeed, liftAccel, startFlip, stepVehicle,
  type VehicleInput, type VehicleState, type VehicleWorld,
} from './vehicle';

const world: VehicleWorld = { halfWidth: () => 10.5 };

function run(s: VehicleState, input: Partial<VehicleInput>, seconds: number, dt = 1 / 60) {
  const i = Object.assign(createInput(), input);
  const ev = createEvents();
  const n = Math.round(seconds / dt);
  for (let k = 0; k < n; k++) stepVehicle(s, i, dt, world, ev);
  return ev;
}

describe('drive', () => {
  it('goes 0 to 100 km/h in about 2.2 s with full throttle', () => {
    const s = createVehicle();
    const i = Object.assign(createInput(), { throttle: 1 });
    const ev = createEvents();
    let t = 0;
    while (forwardSpeed(s) < 100 * KMH && t < 10) {
      stepVehicle(s, i, 1 / 60, world, ev);
      t += 1 / 60;
    }
    expect(t).toBeGreaterThan(2.0);
    expect(t).toBeLessThan(2.4);
  });

  it('tops out near 320 km/h and does not exceed it without boost', () => {
    const s = createVehicle();
    run(s, { throttle: 1 }, 60);
    const kmh = forwardSpeed(s) / KMH;
    expect(kmh).toBeGreaterThan(316);
    expect(kmh).toBeLessThanOrEqual(320.5);
  });

  it('brakes to a stop and never reverses', () => {
    const s = createVehicle();
    s.vz = -40;
    run(s, { brake: 1 }, 3);
    expect(forwardSpeed(s)).toBe(0);
  });

  it('coasts down slowly when the throttle is released', () => {
    const s = createVehicle();
    s.vz = -50;
    run(s, {}, 2);
    expect(forwardSpeed(s)).toBeLessThan(50);
    expect(forwardSpeed(s)).toBeGreaterThan(40);
  });

  it('is frame-rate independent (60 Hz vs 30 Hz within 1%)', () => {
    const a = createVehicle();
    const b = createVehicle();
    run(a, { throttle: 1 }, 4, 1 / 60);
    run(b, { throttle: 1 }, 4, 1 / 30);
    expect(Math.abs(forwardSpeed(a) - forwardSpeed(b)) / forwardSpeed(a)).toBeLessThan(0.01);
    expect(Math.abs(a.z - b.z) / Math.abs(a.z)).toBeLessThan(0.01);
  });

  it('advances toward -Z', () => {
    const s = createVehicle();
    run(s, { throttle: 1 }, 1);
    expect(s.z).toBeLessThan(-5);
  });
});

describe('steering and bounds', () => {
  it('does not strafe from a standstill on the ground', () => {
    const s = createVehicle();
    run(s, { steer: 1 }, 1);
    expect(Math.abs(s.x)).toBeLessThan(0.05);
  });

  it('moves sideways when rolling, and the response depends on speed', () => {
    const slow = createVehicle();
    const fast = createVehicle();
    slow.vz = -100 * KMH;
    fast.vz = -300 * KMH;
    run(slow, { steer: 1 }, 1);
    run(fast, { steer: 1 }, 1);
    expect(slow.x).toBeGreaterThan(4);
    expect(fast.x).toBeGreaterThan(2);
    expect(fast.x).toBeLessThan(slow.x); // less lateral authority at 300 km/h
  });

  it('smooths the steering input instead of snapping to it', () => {
    const s = createVehicle();
    s.vz = -100 * KMH;
    run(s, { steer: 1 }, 1 / 60);
    expect(s.steer).toBeGreaterThan(0);
    expect(s.steer).toBeLessThan(0.5);
  });

  it('stays inside the road and bounces off the barrier', () => {
    const s = createVehicle();
    s.vz = -100 * KMH;
    const ev = run(s, { steer: 1 }, 0.5);
    let hit = ev.barrierHit;
    const i = Object.assign(createInput(), { steer: 1 });
    for (let k = 0; k < 360; k++) {
      stepVehicle(s, i, 1 / 60, world, ev);
      hit = hit || ev.barrierHit;
      expect(s.x).toBeLessThanOrEqual(10.5 - 0.95);
    }
    expect(hit).toBe(true);
  });

  it('leans and yaws toward the turn (visual attitude)', () => {
    const s = createVehicle();
    s.vz = -100 * KMH;
    run(s, { steer: 1 }, 0.6);
    expect(s.roll).toBeLessThan(0); // banks into a right turn
    expect(s.yaw).toBeLessThan(0); // nose swings toward +x
    expect(Math.abs(s.roll)).toBeLessThan(0.3);
  });
});

describe('gravity, thrust and gas', () => {
  it('lift is 2.2 g up to 25 m, then tapers to nothing', () => {
    expect(liftAccel(0)).toBeCloseTo(2.2 * G0, 5);
    expect(liftAccel(25)).toBeCloseTo(2.2 * G0, 5);
    expect(liftAccel(36)).toBeGreaterThan(0);
    expect(liftAccel(36)).toBeLessThan(liftAccel(30));
    expect(liftAccel(48)).toBe(0);
    expect(liftAccel(80)).toBe(0);
  });

  it('falls under about 1.6 g (with a little air drag)', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 200;
    run(s, {}, 0.5);
    expect(s.vy).toBeLessThan(-6.9);
    expect(s.vy).toBeGreaterThan(-7.9);
  });

  it('lands, becomes grounded and reports the landing once', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 3;
    const i = createInput();
    const ev = createEvents();
    let landings = 0;
    for (let k = 0; k < 240; k++) {
      stepVehicle(s, i, 1 / 60, world, ev);
      if (ev.landed) landings++;
    }
    expect(landings).toBe(1);
    expect(s.grounded).toBe(true);
    expect(s.y).toBe(0);
    expect(s.vy).toBe(0);
  });

  it('thrust lifts off with a net 0.6 g (2.2 g lift against 1.6 g gravity)', () => {
    const s = createVehicle();
    const i = Object.assign(createInput(), { thrust: true });
    const ev = createEvents();
    let lifted = false;
    for (let k = 0; k < 30; k++) {
      stepVehicle(s, i, 1 / 60, world, ev);
      lifted = lifted || ev.liftoff;
    }
    expect(lifted).toBe(true);
    expect(s.grounded).toBe(false);
    // once the thrusters have spooled up, the net climb acceleration is (2.2 - 1.6) g minus a little drag
    const v1 = s.vy;
    for (let k = 0; k < 15; k++) stepVehicle(s, i, 1 / 60, world, ev);
    const netAccel = (s.vy - v1) / 0.25;
    expect(netAccel).toBeGreaterThan(4.4);
    expect(netAccel).toBeLessThan(0.6 * G0 + 0.1);
  });

  it('holding thrust settles into a hover between the taper start and its end', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 20;
    const i = Object.assign(createInput(), { thrust: true });
    const ev = createEvents();
    for (let k = 0; k < 60 * 14; k++) {
      s.gas = 1; // isolate the physics from the gas limit
      stepVehicle(s, i, 1 / 60, world, ev);
    }
    expect(s.y).toBeGreaterThan(27);
    expect(s.y).toBeLessThan(34);
    expect(Math.abs(s.vy)).toBeLessThan(1);
  });

  it('drains gas while thrusting and cuts the thrust when the tank is empty', () => {
    const s = createVehicle();
    const i = Object.assign(createInput(), { thrust: true });
    const ev = createEvents();
    for (let k = 0; k < 60; k++) stepVehicle(s, i, 1 / 60, world, ev);
    expect(s.gas).toBeLessThan(0.85);
    expect(s.gas).toBeGreaterThan(0.7);
    for (let k = 0; k < 60 * 8; k++) stepVehicle(s, i, 1 / 60, world, ev);
    expect(s.gas).toBe(0);
    expect(s.gasLocked).toBe(true);
    expect(s.thrustLevel).toBeLessThan(0.05);
  });

  it('refills the tank on the ground and unlocks the thrusters', () => {
    const s = createVehicle();
    s.gas = 0;
    s.gasLocked = true;
    run(s, {}, 1);
    expect(s.gas).toBeGreaterThan(0.25);
    expect(s.gasLocked).toBe(false);
  });
});

describe('landing burn', () => {
  it('cushions a fall with no input and costs no gas', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 20;
    const i = createInput();
    const ev = createEvents();
    let burned = false;
    let touch = 0;
    for (let k = 0; k < 60 * 6; k++) {
      stepVehicle(s, i, 1 / 60, world, ev);
      burned = burned || ev.burnStarted;
      if (ev.landed) touch = ev.impactSpeed;
    }
    expect(burned).toBe(true);
    expect(touch).toBeGreaterThan(0);
    expect(touch).toBeLessThan(6);
    expect(s.gas).toBe(1);
  });

  it('also cushions a 15 m drop that starts with a strong downward speed', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 15;
    s.vy = -10;
    const i = createInput();
    const ev = createEvents();
    let touch = 99;
    for (let k = 0; k < 60 * 5; k++) {
      stepVehicle(s, i, 1 / 60, world, ev);
      if (ev.landed) touch = ev.impactSpeed;
    }
    expect(touch).toBeLessThan(8);
  });
});

describe('hover brake (S while thrusting in the air)', () => {
  it('kills forward speed and holds altitude for an in-place hover', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 4;
    s.vz = -40;
    const i = Object.assign(createInput(), { thrust: true, brake: 1 });
    const ev = createEvents();
    for (let k = 0; k < 60 * 3; k++) {
      s.gas = 1;
      stepVehicle(s, i, 1 / 60, world, ev);
    }
    expect(forwardSpeed(s)).toBeLessThan(0.5);
    expect(s.hoverHold).toBe(true);
    expect(Math.abs(s.y - 4)).toBeLessThan(2.5);
    expect(Math.abs(s.vy)).toBeLessThan(1);
  });

  it('S plus thrust on the ground still lifts off (the hold only engages once airborne)', () => {
    const s = createVehicle();
    s.vz = -30;
    run(s, { thrust: true, brake: 1 }, 1.2);
    expect(s.grounded).toBe(false);
    expect(s.y).toBeGreaterThan(1.5);
    expect(forwardSpeed(s)).toBeLessThan(6); // and it is already braking the forward speed
  });

  it('S without thrusters in the air only brakes lightly', () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 100;
    s.vz = -40;
    run(s, { brake: 1 }, 1);
    expect(forwardSpeed(s)).toBeGreaterThan(30);
  });
});

describe('barrel roll', () => {
  const airborne = () => {
    const s = createVehicle();
    s.grounded = false;
    s.y = 12;
    s.vy = 0;
    s.vz = -30;
    return s;
  };

  it('Q/E starts a roll in the air that finishes on its own in about 0.8 s', () => {
    const s = airborne();
    const ev = createEvents();
    stepVehicle(s, Object.assign(createInput(), { roll: 1 }), 1 / 60, world, ev);
    expect(ev.rollStarted).toBe(true);
    expect(s.barrelT).toBeGreaterThan(0);
    const idle = createInput();
    let t = 1 / 60;
    let done = false;
    let mid = 0;
    while (!done && t < 2) {
      s.gas = 1;
      stepVehicle(s, idle, 1 / 60, world, ev);
      t += 1 / 60;
      if (Math.abs(t - 0.4) < 0.01) mid = Math.abs(s.barrel);
      done = ev.rollCompleted;
    }
    expect(done).toBe(true);
    expect(t).toBeGreaterThan(0.7);
    expect(t).toBeLessThan(0.9);
    expect(mid).toBeGreaterThan(Math.PI * 0.8); // about half way round at half time
    expect(s.rollCount).toBe(1);
    expect(s.barrelT).toBe(0);
    expect(s.barrel).toBe(0);
  });

  it('is ignored on the ground', () => {
    const s = createVehicle();
    const ev = createEvents();
    stepVehicle(s, Object.assign(createInput(), { roll: 1 }), 1 / 60, world, ev);
    expect(ev.rollStarted).toBe(false);
    expect(s.barrelT).toBe(0);
  });

  it('cannot be restarted while a roll is running', () => {
    const s = airborne();
    const ev = createEvents();
    stepVehicle(s, Object.assign(createInput(), { roll: -1 }), 1 / 60, world, ev);
    const dir = s.barrelDir;
    stepVehicle(s, Object.assign(createInput(), { roll: 1 }), 1 / 60, world, ev);
    expect(ev.rollStarted).toBe(false);
    expect(s.barrelDir).toBe(dir);
  });

  it('rolls right for E (+1) and left for Q (-1)', () => {
    const r = airborne();
    const l = airborne();
    const ev = createEvents();
    stepVehicle(r, Object.assign(createInput(), { roll: 1 }), 1 / 60, world, ev);
    stepVehicle(l, Object.assign(createInput(), { roll: -1 }), 1 / 60, world, ev);
    for (let k = 0; k < 10; k++) {
      stepVehicle(r, createInput(), 1 / 60, world, ev);
      stepVehicle(l, createInput(), 1 / 60, world, ev);
    }
    expect(r.barrel).toBeLessThan(0); // clockwise seen from behind
    expect(l.barrel).toBeGreaterThan(0);
  });

  it('landing in the middle of a roll is reported as a crash condition', () => {
    const s = airborne();
    s.y = 1.2;
    s.vy = -8;
    const ev = createEvents();
    stepVehicle(s, Object.assign(createInput(), { roll: 1 }), 1 / 60, world, ev);
    let mid = false;
    for (let k = 0; k < 30 && !mid; k++) {
      stepVehicle(s, createInput(), 1 / 60, world, ev);
      if (ev.landed) mid = ev.landedMidRoll;
    }
    expect(mid).toBe(true);
    expect(s.barrelT).toBe(0); // the roll state is cleared on touchdown
  });
});

describe('crash and boom helpers', () => {
  it('a crash cuts speed sharply, hops, and grants 2 s of invulnerability', () => {
    const s = createVehicle();
    s.vz = -60;
    applyCrash(s);
    expect(forwardSpeed(s)).toBeLessThan(60 * 0.4);
    expect(s.vy).toBeGreaterThan(0);
    expect(s.grounded).toBe(false);
    expect(s.invuln).toBe(PHYS.invuln);
    const ev = createEvents();
    run(s, {}, 2.1);
    expect(s.invuln).toBe(0);
    void ev;
  });

  it('a boom hit slows the car but is not a crash', () => {
    const s = createVehicle();
    s.vz = -40;
    applyBoomHit(s);
    expect(forwardSpeed(s)).toBeGreaterThan(25);
    expect(forwardSpeed(s)).toBeLessThan(35);
    expect(s.invuln).toBe(0);
  });
});
