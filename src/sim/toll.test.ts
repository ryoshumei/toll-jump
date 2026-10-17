import { describe, expect, it } from 'vitest';
import { PLAZA, ROAD } from '../config';
import { carBox, makeBox } from './collision';
import { plazaZ } from './course';
import {
  PLAZA_LANES, boomArms, createTollResult, createTollTracker, isEtcLane, tollPrice, updateToll, type TollOutcome,
} from './toll';

const P = ROAD.plazaPitch;
const laneX = (lane: number) => (lane - (PLAZA_LANES - 1) / 2) * P; // plaza lane centres
const MANUAL = 3; // plaza 0: lanes 0, 2, 4 are ETC; 1, 3, 5 are manual
const ETC = 2;

interface PassOpts { t?: ReturnType<typeof createTollTracker>; p?: number; x?: number; y?: number; speed?: number; push?: boolean }
/** Drive a car through plaza p at a fixed altitude; optionally apply the curb deflection like the game does. */
function pass(o: PassOpts = {}) {
  const t = o.t ?? createTollTracker();
  const p = o.p ?? 0;
  let x = o.x ?? laneX(MANUAL);
  const y = o.y ?? 0;
  const speed = o.speed ?? 40;
  const outcomes: TollOutcome[] = [];
  const res = createTollResult();
  const box = makeBox();
  let curbs = 0;
  let fresh = 0;
  let z = plazaZ(p) + 60;
  while (z > plazaZ(p) - 60) {
    const prev = z;
    z -= speed / 60;
    carBox(box, x, y, z);
    const out = updateToll(t, box, prev, res);
    if (out !== 'none') outcomes.push(out);
    if (res.curb) { curbs++; if (res.curbFresh) fresh++; if (o.push) x += res.pushX; }
  }
  return { outcomes, t, res, curbs, fresh, x };
}

describe('toll price', () => {
  it('starts at 45 and grows a bit at each plaza', () => {
    expect(tollPrice(0)).toBe(45);
    expect(tollPrice(1)).toBe(50);
    expect(tollPrice(4)).toBe(65);
  });
});

describe('a plaza you can drive through at speed', () => {
  it('has 6 lanes, openings of at least 5.5 m, islands about 1.2 m wide, and hitboxes smaller than the visuals', () => {
    expect(PLAZA_LANES).toBe(6);
    expect(P - 2 * PLAZA.islandHalfWidth).toBeGreaterThanOrEqual(5.5);
    expect(PLAZA.islandHalfWidth * 2).toBeCloseTo(1.2, 1);
    expect(PLAZA.islandHitHalf).toBeLessThan(PLAZA.islandHalfWidth);
    expect(PLAZA.boothHitHalfWidth).toBeLessThan(PLAZA.boothHalfWidth);
    expect(PLAZA.pillarHitHalf).toBeLessThan(PLAZA.pillarHalf);
    expect(boomArms.length).toBe(6);
  });

  it('about half the lanes are ETC lanes, alternating from one plaza to the next', () => {
    for (const p of [0, 1, 2, 3]) {
      const n = Array.from({ length: PLAZA_LANES }, (_, l) => isEtcLane(p, l)).filter(Boolean).length;
      expect(n).toBe(3);
    }
    expect(isEtcLane(0, 2)).toBe(true);
    expect(isEtcLane(0, 3)).toBe(false);
    expect(isEtcLane(1, 3)).toBe(true);
  });
});

describe('toll outcomes', () => {
  it('flying over the canopy roof (above 7.5 m) is a flyover', () => {
    const { outcomes, res } = pass({ y: 9 });
    expect(outcomes).toEqual(['flyover']);
    expect(res.price).toBe(45);
  });

  it('clearing the boom in the air, under the canopy, is a jump', () => {
    expect(pass({ y: 2.5 }).outcomes).toEqual(['jump']);
  });

  it('passing just over the canopy but below 7.5 m only counts as clearing the boom', () => {
    expect(pass({ y: 7.2 }).outcomes).toEqual(['jump']);
  });

  it('driving through an ETC lane on the ground, at any speed, is a legal ETC pass: nothing broken', () => {
    for (const speed of [15, 40, 90]) {
      const { outcomes, t, res } = pass({ x: laneX(ETC), speed });
      expect(outcomes, `${speed} m/s`).toEqual(['etc']);
      expect(res.lane).toBe(ETC);
      expect(res.price).toBe(45);
      expect(t.boomBroken[ETC]).toBe(0);
    }
  });

  it('ramming a manual lane boom on the ground snaps it', () => {
    const { outcomes, t, res } = pass({ x: laneX(MANUAL) });
    expect(outcomes).toEqual(['ram']);
    expect(res.lane).toBe(MANUAL);
    expect(t.boomBroken[MANUAL]).toBe(1);
    expect(t.boomBroken[ETC]).toBe(0);
  });

  it('hitting a booth cabin head-on is a crash, reported once', () => {
    expect(pass({ x: P }).outcomes).toEqual(['crash']); // dead centre on an island, into its booth
  });

  it('hitting the canopy underside or the front valance is a crash', () => {
    expect(pass({ y: 5.4 }).outcomes).toEqual(['crash']);
    expect(pass({ y: 4.0 }).outcomes).toEqual(['crash']);
  });

  it('is silent away from any plaza', () => {
    const t = createTollTracker();
    const res = createTollResult();
    const box = makeBox();
    carBox(box, 0, 0, -400);
    expect(updateToll(t, box, -399, res)).toBe('none');
    expect(res.curb).toBe(false);
  });

  it('moves on to the next plaza, whose price is higher, and clears the booms', () => {
    const t = createTollTracker();
    pass({ t, x: laneX(MANUAL) });
    expect(t.boomBroken[MANUAL]).toBe(1);
    const b = pass({ t, p: 1, x: laneX(2), y: 9 });
    expect(b.outcomes).toEqual(['flyover']);
    expect(b.res.price).toBe(tollPrice(1));
    expect(t.boomBroken[MANUAL]).toBe(0);
  });
});

describe('grazing an island curb deflects the car instead of crashing it', () => {
  it('pushes it back into the opening, is not a crash, and reports a fresh scrape only now and then', () => {
    const x0 = laneX(MANUAL) + 2.1; // 0.2 m of the car over the island's hitbox
    const { outcomes, curbs, fresh, x } = pass({ x: x0, push: true });
    expect(outcomes).not.toContain('crash');
    expect(curbs).toBeGreaterThan(0);
    expect(fresh).toBeGreaterThanOrEqual(1);
    expect(fresh).toBeLessThan(curbs + 1);
    expect(x).toBeLessThan(x0);
    expect(outcomes).toEqual(['ram']); // and it still goes through the manual lane
  });

  it('the push points away from the island', () => {
    const left = pass({ x: laneX(MANUAL) - 2.1, push: true }); // toward the island on the other side
    expect(left.curbs).toBeGreaterThan(0);
    expect(left.x).toBeGreaterThan(laneX(MANUAL) - 2.1);
  });

  it('driving straight down the middle of a lane never touches anything', () => {
    for (const lane of [0, 1, 2, 3, 4, 5]) {
      const r = pass({ x: laneX(lane), push: true });
      expect(r.curbs, `lane ${lane}`).toBe(0);
      expect(r.outcomes).not.toContain('crash');
    }
  });

  it('flying over a curb is no scrape at all', () => {
    expect(pass({ x: laneX(MANUAL) + 2.3, y: 0.5 }).curbs).toBe(0);
  });
});
