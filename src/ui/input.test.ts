import { describe, expect, it } from 'vitest';
import { KMH, TOUCH } from '../config';
import { createEvents, createInput, createVehicle, forwardSpeed, stepVehicle } from '../sim/vehicle';
import { cruiseThrottle, Input, pedals } from './input';

function setup() {
  const target = new EventTarget();
  (globalThis as unknown as { document: EventTarget }).document = new EventTarget();
  const input = new Input(target as unknown as Window);
  const key = (type: 'keydown' | 'keyup', code: string) =>
    target.dispatchEvent(Object.assign(new Event(type), { code, repeat: false, preventDefault() {} }));
  return { input, down: (c: string) => key('keydown', c), up: (c: string) => key('keyup', c) };
}

describe('keys held across a restart', () => {
  it('are ignored until they are let go and pressed again', () => {
    const { input, down, up } = setup();
    down('KeyW'); down('ShiftLeft'); down('Space');
    input.poll();
    expect(input.throttle).toBe(1);
    expect(input.boost).toBe(true);
    expect(input.thrust).toBe(true);

    input.releaseHeld(); // the run restarts while the player still holds them
    input.poll();
    expect(input.throttle).toBe(0);
    expect(input.boost).toBe(false);
    expect(input.thrust).toBe(false);

    up('KeyW'); down('KeyW'); // lifts and presses the throttle again
    input.poll();
    expect(input.throttle).toBe(1);
    expect(input.boost).toBe(false); // Shift is still the old press
    up('ShiftLeft'); down('ShiftLeft');
    input.poll();
    expect(input.boost).toBe(true);
  });

  it('do not affect keys pressed after the restart, or the one-frame pulses', () => {
    const { input, down } = setup();
    down('KeyD');
    input.releaseHeld();
    down('KeyW');
    input.poll();
    expect(input.throttle).toBe(1);
    expect(input.steer).toBe(0); // D was held through the restart
    down('KeyR');
    expect(input.restartPulse).toBe(true);
  });
});

describe('pedals', () => {
  it('touch drives by itself, and its brake holds the car on the arena wall', () => {
    expect(pedals(false, false, true, false)).toEqual([TOUCH.maxThrottle, 0]); // on the road: drives forward, gently
    expect(pedals(false, false, true, false, TOUCH.cruise)).toEqual([0, 0]); // and stops pushing at the cruise speed
    expect(pedals(false, true, true, false)).toEqual([0, 1]); // on the road: brakes
    expect(pedals(false, false, true, true, TOUCH.cruise)).toEqual([1, 0]); // on the wall: climbs, whatever the speed
    expect(pedals(false, true, true, true)).toEqual([0, 0]); // on the wall: holds still (no throttle, no descent)
  });

  it('touch cruises: a gentle launch, then it settles just under the cruise speed', () => {
    const s = createVehicle();
    const i = createInput();
    const ev = createEvents();
    const world = { halfWidth: () => 10.5 };
    let t = 0, t100 = 0, peak = 0;
    for (; t < 30; t += 1 / 60) {
      [i.throttle, i.brake] = pedals(false, false, true, false, forwardSpeed(s));
      stepVehicle(s, i, 1 / 60, world, ev);
      if (!t100 && forwardSpeed(s) >= 100 * KMH) t100 = t;
      peak = Math.max(peak, forwardSpeed(s));
    }
    expect(t100).toBeGreaterThan(3.3); // flooring it takes 2.2 s
    expect(t100).toBeLessThan(4.5);
    expect(peak).toBeLessThanOrEqual(TOUCH.cruise);
    expect(forwardSpeed(s)).toBeGreaterThan(150 * KMH);

    i.boost = true; // BOOST still goes past it
    for (let k = 0; k < 120; k++) {
      [i.throttle, i.brake] = pedals(false, false, true, false, forwardSpeed(s));
      stepVehicle(s, i, 1 / 60, world, ev);
    }
    expect(forwardSpeed(s)).toBeGreaterThan(200 * KMH);
  });

  it('touch throttle eases off toward the cruise speed', () => {
    expect(cruiseThrottle(0)).toBe(TOUCH.maxThrottle);
    expect(cruiseThrottle(-5)).toBe(TOUCH.maxThrottle); // rolling back: full launch throttle
    const mid = cruiseThrottle(TOUCH.cruise - TOUCH.cruiseBand / 4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(TOUCH.maxThrottle);
    expect(cruiseThrottle(TOUCH.cruise)).toBe(0);
    expect(cruiseThrottle(TOUCH.cruise + 20)).toBe(0); // after a boost it coasts back down
  });

  it('leave the keyboard as it was, on the road and on the wall', () => {
    for (const onWall of [false, true]) {
      expect(pedals(true, false, false, onWall)).toEqual([1, 0]);
      expect(pedals(false, true, false, onWall)).toEqual([0, 1]); // S still descends the wall
      expect(pedals(false, false, false, onWall)).toEqual([0, 0]);
    }
  });

  it('are what Input.poll uses', () => {
    const { input, down, up } = setup();
    input.autoThrottle = true;
    input.onWall = true;
    input.poll();
    expect([input.throttle, input.brake]).toEqual([1, 0]);
    down('KeyS'); // the same brake signal the touch button gives
    input.poll();
    expect([input.throttle, input.brake]).toEqual([0, 0]);
    expect(input.brakeLight).toBe(1); // the brake lights still show it
    input.onWall = false;
    input.poll();
    expect([input.throttle, input.brake]).toEqual([0, 1]);
    up('KeyS');
    input.fwd = TOUCH.cruise; // the game sets it every frame, like onWall
    input.poll();
    expect([input.throttle, input.brake]).toEqual([0, 0]);
  });
});
