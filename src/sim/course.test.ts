import { describe, expect, it } from 'vitest';
import { EXIT, PLAZA, ROAD } from '../config';
import {
  exitGap, exitGateZ, exitRampX, exitRightExtra, exitZ, laneLineAlpha, laneLineX, nearestExit, nearestPlaza,
  pickLane, plazaTaper, plazaZ, roadHalfWidth, trafficKeepOut,
} from './course';

describe('toll plaza schedule', () => {
  it('puts the first plaza at 800 m and then one every 2 km', () => {
    expect(plazaZ(0)).toBe(-800);
    expect(plazaZ(1)).toBe(-2800);
    expect(plazaZ(4)).toBe(-8800);
  });

  it('finds the nearest plaza for any z', () => {
    expect(nearestPlaza(0)).toBe(0);
    expect(nearestPlaza(-700)).toBe(0);
    expect(nearestPlaza(-1700)).toBe(0);
    expect(nearestPlaza(-2000)).toBe(1);
    expect(nearestPlaza(-9000)).toBe(4);
  });
});

describe('road width', () => {
  it('is 4 lanes of 3.75 m plus 3 m shoulders on the open road', () => {
    expect(roadHalfWidth(-300)).toBeCloseTo(2 * ROAD.laneW + ROAD.shoulder, 6);
    expect(roadHalfWidth(0)).toBeCloseTo(10.5, 6);
    expect(roadHalfWidth(-1500)).toBeCloseTo(10.5, 6);
  });

  it('is 6 wide plaza lanes at the booths', () => {
    expect(roadHalfWidth(plazaZ(0))).toBeCloseTo(3 * ROAD.plazaPitch + ROAD.plazaShoulder, 6);
    expect(roadHalfWidth(plazaZ(2))).toBeCloseTo(3 * 6.7 + 1.5, 6);
  });

  it('widens over a taper before the plaza and narrows again after it', () => {
    const p = plazaZ(0);
    let prev = roadHalfWidth(p + PLAZA.widenFrom);
    expect(prev).toBeCloseTo(10.5, 6);
    for (let d = PLAZA.widenFrom - 10; d >= PLAZA.widenTo; d -= 10) {
      const w = roadHalfWidth(p + d);
      expect(w).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = w;
    }
    expect(prev).toBeCloseTo(3 * 6.7 + 1.5, 6);
    expect(roadHalfWidth(p + PLAZA.widenFrom / 2 + PLAZA.widenTo / 2)).toBeGreaterThan(12); // actually widening mid-taper
    expect(roadHalfWidth(p - PLAZA.narrowTo)).toBeCloseTo(10.5, 6);
    expect(roadHalfWidth(p - PLAZA.narrowTo - 50)).toBeCloseTo(10.5, 6);
    expect(roadHalfWidth(p - 100)).toBeLessThan(3 * 6.7 + 1.5);
    expect(roadHalfWidth(p - 100)).toBeGreaterThan(10.5);
  });

  it('exposes the taper as 0..1', () => {
    expect(plazaTaper(0)).toBe(0);
    expect(plazaTaper(plazaZ(0))).toBe(1);
    const t = plazaTaper(plazaZ(0) + 150);
    expect(t).toBeGreaterThan(0);
    expect(t).toBeLessThan(1);
  });
});

describe('lane lines fan out over the taper', () => {
  it('sit on the 4-lane boundaries on the open road (lines -3..3)', () => {
    expect(laneLineX(-1, -300)).toBeCloseTo(-3.75, 6);
    expect(laneLineX(0, -300)).toBeCloseTo(0, 6);
    expect(laneLineX(1, -300)).toBeCloseTo(3.75, 6);
    expect(laneLineX(3, -300)).toBeCloseTo(7.5, 6); // the solid edge line
  });

  it('become the 6-lane boundaries (6.7 m apart) inside the plaza', () => {
    const z = plazaZ(0);
    expect(laneLineX(1, z)).toBeCloseTo(6.7, 6);
    expect(laneLineX(-2, z)).toBeCloseTo(-13.4, 6);
    expect(laneLineX(3, z)).toBeCloseTo(20.1, 6);
  });

  it('the two extra lines fade in during the taper; the original ones are always visible', () => {
    expect(laneLineAlpha(1, -300)).toBe(1);
    expect(laneLineAlpha(2, -300)).toBe(0);
    expect(laneLineAlpha(2, plazaZ(0))).toBe(1);
    const mid = laneLineAlpha(2, plazaZ(0) + 150);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});

describe('stunt arena exit ramps (the highway has no wall)', () => {
  it('the first exit is about 1.5 km out and exits are about 3 km apart', () => {
    expect(exitZ(0)).toBe(-1500);
    for (let i = 1; i < 8; i++) {
      const gap = exitZ(i - 1) - exitZ(i);
      expect(gap).toBeGreaterThan(2000);
      expect(gap).toBeLessThan(4500);
    }
  });

  it('never sits near a toll plaza', () => {
    for (let i = 0; i < 20; i++) expect(Math.abs(exitZ(i) - plazaZ(nearestPlaza(exitZ(i))))).toBeGreaterThan(500);
  });

  it('the ramp peels off the right lane and ends beyond the barrier, with an opening in it', () => {
    const z0 = exitZ(0);
    expect(exitRampX(0, z0)).toBeCloseTo(5.625, 2);
    expect(exitRampX(0, exitGateZ(0))).toBeCloseTo(10.5 + EXIT.lateral, 1);
    expect(exitRightExtra(z0 + 300)).toBe(0);
    expect(exitRightExtra(z0 - EXIT.length / 2)).toBeGreaterThan(1);
    expect(exitGap(z0 - 30)).toBe(true);
    expect(exitGap(z0 + 300)).toBe(false);
    expect(nearestExit(z0 - 20)).toBe(0);
  });
});

describe('traffic stays light', () => {
  it('is kept out of the 150 m before a toll plaza and before the arena exit', () => {
    expect(trafficKeepOut(plazaZ(0) + 100)).toBe(true);
    expect(trafficKeepOut(plazaZ(0) + 150)).toBe(true);
    expect(trafficKeepOut(plazaZ(0) - 40)).toBe(true);
    expect(trafficKeepOut(-300)).toBe(false);
    expect(trafficKeepOut(exitZ(0) + 120)).toBe(true);
    expect(trafficKeepOut(exitZ(0) - EXIT.length - 20)).toBe(true);
  });

  it('never fills all four lanes: at least one lane stays clear', () => {
    expect(pickLane(0b0111, 0.5)).toBe(-1);
    expect(pickLane(0b1011, 0.2)).toBe(-1);
    expect(pickLane(0b0011, 0.0)).toBeGreaterThanOrEqual(2);
    for (let r = 0; r < 1; r += 0.07) {
      const l = pickLane(0b0001, r);
      expect(l).toBeGreaterThanOrEqual(1);
      expect(l).toBeLessThanOrEqual(3);
    }
    const free = pickLane(0, 0.99);
    expect(free).toBeGreaterThanOrEqual(0);
    expect(free).toBeLessThanOrEqual(3);
  });
});
