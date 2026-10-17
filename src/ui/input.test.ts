import { describe, expect, it } from 'vitest';
import { Input } from './input';

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
