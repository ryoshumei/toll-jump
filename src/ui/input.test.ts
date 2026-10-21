import { describe, expect, it } from 'vitest';
import { Input, pedals } from './input';

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
    expect(pedals(false, false, true, false)).toEqual([1, 0]); // on the road: drives forward
    expect(pedals(false, true, true, false)).toEqual([0, 1]); // on the road: brakes
    expect(pedals(false, false, true, true)).toEqual([1, 0]); // on the wall: climbs
    expect(pedals(false, true, true, true)).toEqual([0, 0]); // on the wall: holds still (no throttle, no descent)
  });

  it('leave the keyboard as it was, on the road and on the wall', () => {
    for (const onWall of [false, true]) {
      expect(pedals(true, false, false, onWall)).toEqual([1, 0]);
      expect(pedals(false, true, false, onWall)).toEqual([0, 1]); // S still descends the wall
      expect(pedals(false, false, false, onWall)).toEqual([0, 0]);
    }
  });

  it('are what Input.poll uses', () => {
    const { input, down } = setup();
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
  });
});
