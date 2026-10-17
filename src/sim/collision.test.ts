import { describe, expect, it } from 'vitest';
import { CAR } from '../config';
import { boxGap, carBox, isNearMiss, makeBox, overlaps, setBox, sideGap } from './collision';

const box = (cx: number, cy: number, cz: number, hx: number, hy: number, hz: number) =>
  setBox(makeBox(), cx, cy, cz, hx, hy, hz);

describe('AABB overlap', () => {
  it('detects overlapping boxes', () => {
    expect(overlaps(box(0, 1, 0, 1, 1, 1), box(1.5, 1, 0.5, 1, 1, 1))).toBe(true);
  });

  it('separates on any single axis', () => {
    const a = box(0, 1, 0, 1, 1, 1);
    expect(overlaps(a, box(3, 1, 0, 1, 1, 1))).toBe(false); // x
    expect(overlaps(a, box(0, 4, 0, 1, 1, 1))).toBe(false); // y
    expect(overlaps(a, box(0, 1, -3, 1, 1, 1))).toBe(false); // z
  });

  it('touching faces do not count as a hit', () => {
    expect(overlaps(box(0, 1, 0, 1, 1, 1), box(2, 1, 0, 1, 1, 1))).toBe(false);
  });
});

describe('box gap', () => {
  it('is zero when boxes overlap', () => {
    expect(boxGap(box(0, 1, 0, 1, 1, 1), box(1, 1, 0, 1, 1, 1))).toBe(0);
  });

  it('is the straight-line distance between the closest faces', () => {
    const a = box(0, 1, 0, 1, 1, 1);
    expect(boxGap(a, box(4, 1, 0, 1, 1, 1))).toBeCloseTo(2, 6); // 2 m apart in x
    expect(boxGap(a, box(4, 1, 5, 1, 1, 1))).toBeCloseTo(Math.hypot(2, 3), 6); // diagonal in x and z
  });
});

describe('car box', () => {
  it('is centred on the car, sits on its altitude, and is 1.9 m wide', () => {
    const b = carBox(makeBox(), 3, 2, -50);
    expect(b.maxX - b.minX).toBeCloseTo(2 * CAR.halfW, 6);
    expect(b.minY).toBeCloseTo(2, 6);
    expect(b.maxY).toBeCloseTo(2 + CAR.boxHeight, 6);
    expect((b.minZ + b.maxZ) / 2).toBeCloseTo(-50, 6);
    expect(b.maxZ - b.minZ).toBeCloseTo(2 * CAR.halfL, 6);
  });
});

describe('near miss', () => {
  const car = (x: number) => carBox(makeBox(), x, 0, -100);
  const sedan = (x: number, z = -100) => box(x, 0.7, z, 0.92, 0.7, 2.25);

  it('counts a close side pass at speed', () => {
    // car edge at x=0.95, sedan edge at 0.95+0.6
    expect(isNearMiss(car(0), sedan(0.95 + 0.6 + 0.92), 40)).toBe(true);
  });

  it('ignores a wide pass', () => {
    expect(isNearMiss(car(0), sedan(0.95 + 1.6 + 0.92), 40)).toBe(false);
  });

  it('ignores slow passes', () => {
    expect(isNearMiss(car(0), sedan(0.95 + 0.6 + 0.92), 10)).toBe(false);
  });

  it('is not a near miss when the boxes actually touch (that is a crash)', () => {
    expect(isNearMiss(car(0), sedan(1.2), 40)).toBe(false);
  });

  it('is not a near miss for something that is still far ahead in z', () => {
    expect(isNearMiss(car(0), sedan(0.95 + 0.6 + 0.92, -140), 40)).toBe(false);
  });

  it('counts passing close over the roof of a vehicle', () => {
    const s = box(0, 0.7, -100, 0.92, 0.7, 2.25); // top at y=1.4
    const high = carBox(makeBox(), 0, 1.4 + 0.5, -100);
    expect(sideGap(high, s)).toBeCloseTo(0.5, 6);
    expect(isNearMiss(high, s, 40)).toBe(true);
  });
});
