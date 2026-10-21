import { describe, expect, it } from 'vitest';
import { fitFov, lookAhead, MAX_VFOV, pullBack, raise } from './fov';

// the vertical FOVs camera.ts animates: the studio telephoto, the stunt view, the drone, driving (60-75) and the boost kick
const DESIGN = [28, 46, 52, 60, 67.5, 75, 85];

describe('fitFov on a landscape screen', () => {
  it('leaves every design FOV exactly as it is (phones on their side, desktops, tablets, a square window)', () => {
    for (const aspect of [16 / 9, 844 / 390, 667 / 375, 932 / 430, 4 / 3, 1]) {
      for (const v of DESIGN) expect(fitFov(v, aspect)).toBe(v);
    }
  });
});

/** Horizontal FOV (degrees) of a screen of this aspect (width / height) at this vertical FOV. */
const hFov = (v: number, aspect: number) => (2 * Math.atan(aspect * Math.tan((v * Math.PI) / 360)) * 180) / Math.PI;

describe('fitFov on a portrait screen', () => {
  it('gives the narrow side (the width) the FOV the camera was designed to give the height', () => {
    expect(fitFov(60, 0.75)).toBeCloseTo(75.18, 1); // an iPad held upright
    expect(fitFov(75, 0.75)).toBeCloseTo(91.31, 1); // ...at the top speed's FOV
    expect(fitFov(46, 0.5)).toBeCloseTo(80.66, 1); // the stunt view on a tall phone
    for (const [v, aspect] of [[60, 0.75], [46, 0.5], [52, 0.6]]) expect(hFov(fitFov(v, aspect), aspect)).toBeCloseTo(v, 6);
  });

  it('does not leave a telephoto (the 28 degree start-screen shot) a 28 degree slit: its width gets 46 degrees on a tall phone', () => {
    expect(fitFov(28, 390 / 844)).toBeCloseTo(85.14, 1);
    expect(hFov(fitFov(28, 0.5), 0.5)).toBeCloseTo(46, 6);
    expect(hFov(fitFov(28, 0.75), 0.75)).toBeGreaterThan(28); // and the more upright the screen, the more of it
    expect(hFov(fitFov(28, 0.75), 0.75)).toBeLessThan(46);
  });
});

describe('fitFov is bounded', () => {
  it('never goes past the fisheye limit, however tall the screen or fast the car', () => {
    for (const aspect of [0.2, 0.3, 0.4, 0.4621, 0.5, 0.6]) {
      for (const v of DESIGN) expect(fitFov(v, aspect)).toBeLessThanOrEqual(MAX_VFOV);
    }
    expect(MAX_VFOV).toBeLessThanOrEqual(105);
  });

  it('is never narrower than the design FOV, and a nonsense aspect (0, NaN) changes nothing', () => {
    for (const aspect of [0.2, 0.4621, 0.75, 0.99, 1, 2.16]) {
      for (const v of DESIGN) expect(fitFov(v, aspect)).toBeGreaterThanOrEqual(v);
    }
    for (const aspect of [0, -1, NaN, Infinity]) expect(fitFov(60, aspect)).toBe(60);
  });
});

describe('fitFov while the phone turns', () => {
  it('widens smoothly and never narrows as the screen gets taller, with no jump at the square window', () => {
    for (const v of DESIGN) {
      let prev = fitFov(v, 2);
      for (let aspect = 1.99; aspect > 0.4; aspect -= 0.01) { // down to the tallest phones
        const now = fitFov(v, aspect);
        expect(now).toBeGreaterThanOrEqual(prev);
        expect(now - prev).toBeLessThan(2); // degrees per 0.01 of aspect: a rotation never pops (a jump at a threshold is 5 or more)
        prev = now;
      }
    }
  });
});

describe('pullBack', () => {
  it('is 1 (the camera stays where it was tuned) on a landscape or square screen, and for a nonsense aspect', () => {
    for (const aspect of [16 / 9, 844 / 390, 4 / 3, 1, 0, NaN, -1]) expect(pullBack(aspect)).toBe(1);
  });

  it('moves the camera back a little on a phone held upright, more the taller the screen, smoothly', () => {
    expect(pullBack(390 / 844)).toBeGreaterThan(1.1);
    let prev = 1;
    for (let aspect = 0.99; aspect > 0.4; aspect -= 0.01) {
      const now = pullBack(aspect);
      expect(now).toBeGreaterThanOrEqual(prev);
      expect(now - prev).toBeLessThan(0.01);
      expect(now).toBeLessThanOrEqual(1.3);
      prev = now;
    }
  });
});

describe('raise', () => {
  it('is 0 metres on a landscape or square screen, and for a nonsense aspect', () => {
    for (const aspect of [16 / 9, 844 / 390, 4 / 3, 1, 0, NaN, -1]) expect(raise(aspect)).toBe(0);
  });

  it('lifts the road camera a little on a phone held upright (more road, less sky), smoothly, but never so far that it leaves the space under a toll canopy', () => {
    expect(raise(390 / 844)).toBeGreaterThan(0.8);
    let prev = 0;
    for (let aspect = 0.99; aspect > 0.4; aspect -= 0.01) {
      const now = raise(aspect);
      expect(now).toBeGreaterThanOrEqual(prev);
      expect(now - prev).toBeLessThan(0.05);
      expect(now).toBeLessThanOrEqual(1.5);
      prev = now;
    }
  });
});

describe('lookAhead', () => {
  it('is 1 (the road camera looks as far ahead as it was tuned to) on a landscape or square screen, and for a nonsense aspect', () => {
    for (const aspect of [16 / 9, 844 / 390, 4 / 3, 1, 0, NaN, -1]) expect(lookAhead(aspect)).toBe(1);
  });

  it('looks nearer to the car on a phone held upright, so a raised camera still frames the car and the road beyond, smoothly', () => {
    expect(lookAhead(390 / 844)).toBeLessThan(0.8);
    let prev = 1;
    for (let aspect = 0.99; aspect > 0.4; aspect -= 0.01) {
      const now = lookAhead(aspect);
      expect(now).toBeLessThanOrEqual(prev);
      expect(prev - now).toBeLessThan(0.02);
      expect(now).toBeGreaterThanOrEqual(0.5);
      prev = now;
    }
  });
});
