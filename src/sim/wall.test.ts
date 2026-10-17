import { describe, expect, it } from 'vitest';
import { KMH, WALL } from '../config';
import { carBox, makeBox, overlaps, type Box } from './collision';
import {
  WALL_LENGTH, createWallEvents, createWallState, stepWall, surfaceHeightAt, tryAttach, wallFrameBoxes, wallPose,
  type WallEvents, type WallState,
} from './wall';
import {
  createEvents, createInput, createVehicle, forwardSpeed, stepVehicle, type VehicleInput, type VehicleState,
} from './vehicle';

const world = { halfWidth: () => 56 };
const R = WALL.radius;
const pose = (s: number) => wallPose(s, { z: 0, y: 0, theta: 0 });
const input = (o: Partial<VehicleInput> = {}) => Object.assign(createInput(), o);

interface Ctx { v: VehicleState; w: WallState; last: WallEvents; reason: string }

/** A car rolling at kmh toward the wall on the tarmac; attached the way the game does it. */
function driveIn(kmh: number, x: number = WALL.x, dir = 1): Ctx & { attached: boolean } {
  const v = createVehicle();
  v.x = x; v.z = WALL.z + 3; v.dir = dir; v.vz = -kmh * KMH * dir;
  const w = createWallState();
  const last = createWallEvents();
  const ev = createEvents();
  let attached = false;
  for (let k = 0; k < 240 && !attached; k++) {
    const prev = v.z;
    stepVehicle(v, input(), 1 / 60, world, ev);
    attached = tryAttach(v, w, prev, last);
  }
  return { v, w, last, reason: '', attached };
}

/** Run the wall for some seconds (stops early on a detach). */
function run(c: Ctx, i: VehicleInput, seconds: number, suction = true): void {
  for (let k = 0; k < Math.round(seconds * 60) && c.w.attached; k++) {
    stepWall(c.v, c.w, i, suction, 1 / 60, c.last);
    if (c.last.detached) c.reason = c.last.reason;
  }
}

/** Climb with suction to arc length s and hold there. */
function holdAt(s: number, kmh = 30): Ctx {
  const c = driveIn(kmh);
  const i = input({ throttle: 1 });
  for (let k = 0; k < 60 * 20 && c.w.attached && c.w.s + (c.w.ds * c.w.ds) / (2 * WALL.holdDecel) < s; k++) stepWall(c.v, c.w, i, true, 1 / 60, c.last);
  run(c, input(), 1.2);
  return c;
}

describe('wall shape (about 7 m wide, flat start, 15 degrees past vertical, 20 m tall)', () => {
  it('starts flat at ground level, is vertical a quarter of a circle later, and leans back at the tip', () => {
    expect(pose(0)).toEqual({ z: 0, y: 0, theta: 0 });
    const vert = pose((Math.PI / 2) * R);
    expect(vert.theta).toBeCloseTo(Math.PI / 2, 6);
    expect(vert.y).toBeCloseTo(R, 5);
    expect(vert.z).toBeCloseTo(-R, 5);
    const tip = pose(WALL_LENGTH);
    expect(tip.theta).toBeCloseTo((105 * Math.PI) / 180, 6);
    expect(tip.z).toBeGreaterThan(vert.z); // the overhang leans back over the approach
    expect(tip.y).toBeGreaterThan(19.5);
    expect(tip.y).toBeLessThan(20.5);
    expect(WALL.halfWidth * 2).toBeGreaterThan(6.5);
  });

  it('is continuous and always climbing', () => {
    let prev = pose(0);
    for (let s = 0.1; s <= WALL_LENGTH; s += 0.1) {
      const p = pose(s);
      expect(Math.hypot(p.z - prev.z, p.y - prev.y)).toBeLessThan(0.11);
      expect(p.y).toBeGreaterThanOrEqual(prev.y - 1e-9);
      prev = p;
    }
  });
});

describe('attaching', () => {
  it('a car driving onto the wall at 40 km/h or at 140 km/h is on it, carrying its speed', () => {
    const a = driveIn(40);
    expect(a.attached).toBe(true);
    expect(a.v.mode).toBe('wall');
    expect(a.w.ds).toBeGreaterThan(10);
    const b = driveIn(140);
    expect(b.attached).toBe(true);
    expect(b.w.ds).toBeGreaterThan(35);
  });

  it('misses it when off the ribbon or facing the other way', () => {
    expect(driveIn(60, 12).attached).toBe(false);
    expect(driveIn(60, WALL.x, -1).attached).toBe(false);
  });
});

describe('with suction on', () => {
  it('holds position anywhere, including hanging past vertical', () => {
    for (const s of [8, 20, 26.5]) {
      const c = holdAt(s);
      expect(c.w.attached, `s=${s}`).toBe(true);
      const y = c.v.y;
      run(c, input(), 3);
      expect(c.v.y).toBeCloseTo(y, 6);
      expect(c.w.ds).toBe(0);
    }
    expect(pose(26.5).theta).toBeGreaterThan(Math.PI / 2);
  });

  it('W climbs, S drives back down, A/D move sideways inside the ribbon', () => {
    const c = driveIn(30);
    run(c, input({ throttle: 1 }), 0.8);
    const up = c.w.s;
    expect(up).toBeGreaterThan(8);
    run(c, input({ brake: 1 }), 1.4);
    expect(c.w.s).toBeLessThan(up);
    run(c, input({ steer: 1 }), 2);
    expect(c.w.x).toBeCloseTo(WALL.latLimit, 6);
    run(c, input({ steer: -1 }), 3);
    expect(c.w.x).toBeCloseTo(-WALL.latLimit, 6);
  });
});

describe('without suction the car only stays on while it is fast enough', () => {
  it('a stopped car hanging past vertical falls off the moment suction is switched off', () => {
    const c = holdAt(26.5);
    expect(c.w.attached).toBe(true);
    run(c, input(), 0.3, false);
    expect(c.reason).toBe('fell');
    expect(c.v.mode).toBe('free');
  });

  it('the HUD warning comes on while it is slow and still attached', () => {
    const c = holdAt(22.2); // about 80 degrees: still pressed on, but barely
    run(c, input(), 1 / 60, false);
    expect(c.w.attached).toBe(true);
    expect(c.w.warn).toBe(true);
    const fast = driveIn(150);
    run(fast, input({ throttle: 1 }), 1 / 60, false);
    expect(fast.w.warn).toBe(false);
  });

  it('a fast car makes it to the tip without suction and leaves it', () => {
    const c = driveIn(150);
    run(c, input({ throttle: 1 }), 4, false);
    expect(c.reason).toBe('tip');
  });

  it('a slow car on the lower arc just rolls back down to the base', () => {
    const c = holdAt(8);
    run(c, input(), 6, false);
    expect(c.reason).toBe('base');
    expect(c.v.mode).toBe('free');
  });
});

describe('detaching starts the flip, the turn-around and the descent', () => {
  it('Space detaches at any height', () => {
    for (const s of [1, 10, 20, 27]) {
      const c = holdAt(s);
      run(c, input({ detach: true }), 1 / 60);
      expect(c.reason, `s=${s}`).toBe('manual');
      expect(c.v.flipping).toBe(true);
      expect(c.v.mode).toBe('free');
      expect(c.v.grounded).toBe(false);
    }
  });

  it('driving off the tip leaves the car upside down with its nose up and back', () => {
    const c = holdAt(WALL_LENGTH - 1);
    run(c, input({ throttle: 1 }), 2);
    expect(c.reason).toBe('tip');
    const th = c.v.pitch;
    expect(th).toBeCloseTo((105 * Math.PI) / 180, 1);
    expect(Math.cos(th)).toBeLessThan(0); // roof pointing down: upside down
    expect(Math.sin(th)).toBeGreaterThan(0.9); // nose up...
    expect(-Math.cos(th)).toBeGreaterThan(0); // ...and back toward +Z
  });

  it('flips right side up and turns around in about 1.2 s, then comes down facing the opposite way', () => {
    const c = holdAt(WALL_LENGTH - 1);
    run(c, input({ throttle: 1 }), 2);
    expect(c.reason).toBe('tip');
    const ev = createEvents();
    let mid = false;
    let burned = false;
    let touch = 99;
    let topSpeed = 0;
    for (let k = 1; k <= 60 * 14; k++) {
      stepVehicle(c.v, input(), 1 / 60, world, ev);
      burned = burned || ev.burnStarted;
      if (ev.landed && touch === 99) touch = ev.impactSpeed;
      if (!ev.landed && !c.v.grounded) topSpeed = Math.max(topSpeed, forwardSpeed(c.v));
      if (k === 36) {
        mid = c.v.flipping && c.v.pitch > (105 * Math.PI) / 180 && c.v.roll > 0.3 && c.v.roll < Math.PI - 0.3;
      }
      if (k === 78) {
        expect(c.v.flipping).toBe(false);
        expect(c.v.dir).toBe(-1);
        expect(c.v.heading).toBeCloseTo(Math.PI, 6);
        expect(Math.abs(c.v.pitch)).toBeLessThan(0.35); // upright; the usual nose-with-the-flight-path smoothing resumed
        expect(Math.abs(c.v.roll)).toBeLessThan(0.05);
      }
    }
    expect(mid).toBe(true);
    expect(burned).toBe(true);
    expect(touch).toBeLessThan(7);
    expect(c.v.grounded).toBe(true);
    expect(c.v.dir).toBe(-1);
    expect(c.v.z).toBeGreaterThan(WALL.z); // came down on the approach side
    expect(topSpeed).toBeGreaterThan(2); // it drifts away in the direction it now faces
  });

  it('a detach at the base still finishes the turn (no crash for landing mid-flip)', () => {
    const c = holdAt(0.5, 10);
    run(c, input({ detach: true }), 1 / 60);
    expect(c.reason).toBe('manual');
    const ev = createEvents();
    let crash = false;
    for (let k = 0; k < 60 * 14; k++) {
      stepVehicle(c.v, input(), 1 / 60, world, ev);
      crash = crash || ev.landedMidRoll;
    }
    expect(crash).toBe(false);
    expect(c.v.grounded).toBe(true);
    expect(c.v.dir).toBe(-1);
    expect(c.v.flipping).toBe(false);
  });

  it('a detach high on the wall clears the lower arc: no re-attach, never through the surface', () => {
    const c = holdAt(24);
    run(c, input({ detach: true }), 1 / 60);
    const ev = createEvents();
    let re = false;
    let lowest = 99;
    for (let k = 0; k < 60 * 14; k++) {
      const prev = c.v.z;
      stepVehicle(c.v, input(), 1 / 60, world, ev);
      stepWall(c.v, c.w, input(), false, 1 / 60, createWallEvents());
      if (tryAttach(c.v, c.w, prev, createWallEvents())) re = true;
      const zr = WALL.z - c.v.z;
      if (zr > 0 && zr < R) lowest = Math.min(lowest, c.v.y - surfaceHeightAt(zr));
    }
    expect(re).toBe(false);
    expect(lowest).toBeGreaterThan(-0.3);
    expect(c.v.grounded).toBe(true);
  });
});

describe('wall frame collision boxes', () => {
  const boxes: Box[] = Array.from({ length: 24 }, makeBox);

  it('the rails and the truss exist; a car driving onto the ribbon does not touch them', () => {
    const n = wallFrameBoxes(boxes);
    expect(n).toBeGreaterThan(3);
    const entering = carBox(makeBox(), WALL.x, 0, WALL.z + 1);
    for (let k = 0; k < n; k++) expect(overlaps(entering, boxes[k])).toBe(false);
  });

  it('a car on the rail line crashes into it', () => {
    const n = wallFrameBoxes(boxes);
    const hit = carBox(makeBox(), WALL.x + WALL.halfWidth + 0.3, 0, WALL.z - 1.5);
    let any = false;
    for (let k = 0; k < n; k++) any = any || overlaps(hit, boxes[k]);
    expect(any).toBe(true);
  });
});
