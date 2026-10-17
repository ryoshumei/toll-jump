import { describe, expect, it } from 'vitest';
import {
  createSuction, downforceKN, slideGrip, squatMeters, steerGrip, stepSuction, suctionActive, toggleSuction,
} from './suction';

const run = (s: ReturnType<typeof createSuction>, seconds: number) => {
  for (let k = 0; k < Math.round(seconds * 60); k++) stepSuction(s, 1 / 60);
};

describe('suction (the car\'s own system)', () => {
  it('starts off, and F toggles it', () => {
    const s = createSuction();
    expect(s.on).toBe(false);
    expect(toggleSuction(s)).toBe(true);
    expect(toggleSuction(s)).toBe(false);
  });

  it('spools up over a fraction of a second instead of snapping on', () => {
    const s = createSuction();
    toggleSuction(s);
    stepSuction(s, 1 / 60);
    expect(s.level).toBeGreaterThan(0);
    expect(s.level).toBeLessThan(0.3);
    expect(suctionActive(s)).toBe(false);
    run(s, 0.6);
    expect(s.level).toBeGreaterThan(0.95);
    expect(suctionActive(s)).toBe(true);
  });

  it('spools back down when switched off', () => {
    const s = createSuction();
    toggleSuction(s);
    run(s, 1);
    toggleSuction(s);
    run(s, 1.5);
    expect(s.level).toBeLessThan(0.01);
    expect(suctionActive(s)).toBe(false);
  });

  it('on the road it gives more grip, and squats the car a few centimetres', () => {
    expect(steerGrip(1)).toBeGreaterThan(steerGrip(0));
    expect(slideGrip(1)).toBeGreaterThan(slideGrip(0));
    expect(squatMeters(0)).toBe(0);
    expect(squatMeters(1)).toBeGreaterThan(0.01);
    expect(squatMeters(1)).toBeLessThan(0.06);
  });

  it('reports downforce in kN only while on, and it grows with speed', () => {
    expect(downforceKN(0, 50)).toBe(0);
    const still = downforceKN(1, 0);
    expect(still).toBeGreaterThan(8);
    expect(downforceKN(1, 80)).toBeGreaterThan(still + 4);
  });
});
