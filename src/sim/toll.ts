// Toll plaza pass classification (the meme): flyover, boom jump, ETC pass, boom ram, or crash.
// Pure logic: the car's AABB goes in each step, the outcome (if any) comes out. Grazing an island curb is not a
// crash: it is reported separately (res.curb / res.pushX) and the game deflects the car.
import { PLAZA, ROAD } from '../config';
import { type Box, makeBox, overlaps, setBoxMinMax } from './collision';
import { plazaZ } from './course';

export type TollOutcome = 'none' | 'flyover' | 'jump' | 'ram' | 'etc' | 'crash';

export const PLAZA_LANES = 6;

export interface TollTracker {
  plaza: number; // index of the plaza being tracked
  minYOver: number; // lowest car altitude seen while over the canopy
  crashed: boolean; // a crash was already reported for this plaza
  tolled: boolean; // the boom line was already crossed for this plaza
  curbZ: number; // z of the last scrape that was reported as fresh
  boomBroken: Uint8Array; // one flag per lane, valid for plaza `boomPlaza` (kept while it is still on screen)
  boomPlaza: number;
}

export interface TollResult {
  outcome: TollOutcome;
  plaza: number;
  lane: number;
  price: number;
  curb: boolean; // the car overlaps an island curb this step
  pushX: number; // how far to move it sideways to clear the curb
  curbFresh: boolean; // a new scrape (spark and a little speed loss); false while still sliding along the same one
}

export const tollPrice = (plaza: number): number => PLAZA.basePrice + PLAZA.priceStep * plaza;

/** About half the lanes are ETC lanes, alternating from one plaza to the next. */
export const isEtcLane = (plaza: number, lane: number): boolean => (plaza + lane) % 2 === 0;

export function createTollTracker(): TollTracker {
  return { plaza: 0, minYOver: Infinity, crashed: false, tolled: false, curbZ: Infinity, boomBroken: new Uint8Array(PLAZA_LANES), boomPlaza: 0 };
}

export function createTollResult(): TollResult {
  return { outcome: 'none', plaza: 0, lane: 0, price: 0, curb: false, pushX: 0, curbFresh: false };
}

export function resetTollTracker(t: TollTracker, plaza: number, clearBooms = true): void {
  t.plaza = plaza;
  t.minYOver = Infinity;
  t.crashed = false;
  t.tolled = false;
  t.curbZ = Infinity;
  if (clearBooms) {
    t.boomBroken.fill(0);
    t.boomPlaza = plaza;
  }
}

// --- static geometry in plaza-local coordinates: z' = z - plazaZ, +z' is the approach side ---
const P = ROAD.plazaPitch;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) =>
  setBoxMinMax(makeBox(), x0, y0, z0, x1, y1, z1);

/** Canopy, valance, booth cabins and pillars (hitboxes a little smaller than the visuals). A hit is a crash. */
export const plazaStaticBoxes: Box[] = [];
/** The island curbs: a graze deflects the car. */
export const plazaIslandBoxes: Box[] = [];
/** One boom arm per lane, at the boom line. */
export const boomArms: Box[] = [];
export const laneCenterX = (lane: number): number => (lane - (PLAZA_LANES - 1) / 2) * P;

(function build() {
  const W = PLAZA.canopyHalfWidth;
  const D = PLAZA.canopyHalfDepth;
  plazaStaticBoxes.push(box(-W, PLAZA.canopyUnder, -D, W, PLAZA.canopyTop, D));
  plazaStaticBoxes.push(box(-W, PLAZA.valanceBottom, D - 0.4, W, PLAZA.canopyUnder, D));
  for (let k = -3; k <= 3; k++) {
    const x = k * P;
    plazaIslandBoxes.push(box(x - PLAZA.islandHitHalf, 0, -PLAZA.islandHalfLen, x + PLAZA.islandHitHalf, PLAZA.islandHeight, PLAZA.islandHalfLen));
    plazaStaticBoxes.push(box(x - PLAZA.boothHitHalfWidth, PLAZA.islandHeight, -PLAZA.boothHitHalfLen, x + PLAZA.boothHitHalfWidth, PLAZA.islandHeight + PLAZA.boothHeight, PLAZA.boothHitHalfLen));
    for (const sz of [-1, 1]) {
      const z = sz * PLAZA.pillarZ;
      const h = PLAZA.pillarHitHalf;
      plazaStaticBoxes.push(box(x - h, PLAZA.islandHeight, z - h, x + h, PLAZA.pillarHeight, z + h));
    }
  }
  const armHalf = (P - 2 * PLAZA.islandHalfWidth) / 2;
  for (let lane = 0; lane < PLAZA_LANES; lane++) {
    const x = laneCenterX(lane);
    boomArms.push(box(x - armHalf, PLAZA.boomY0, PLAZA.boomZ - 0.12, x + armHalf, PLAZA.boomY1, PLAZA.boomZ + 0.12));
  }
})();

const local = makeBox();
const LEAVE = PLAZA.canopyHalfDepth + 6; // this far past the plaza centre we move on to the next one

/**
 * Feed the car's AABB (and its previous centre z) every step. Returns the outcome when one is decided,
 * and fills `res`. Each plaza yields at most one toll outcome and at most one crash.
 */
export function updateToll(t: TollTracker, car: Box, prevZ: number, res: TollResult): TollOutcome {
  res.outcome = 'none';
  res.curb = false;
  res.pushX = 0;
  res.curbFresh = false;
  const z = (car.minZ + car.maxZ) * 0.5;
  while (z - plazaZ(t.plaza) < -LEAVE) resetTollTracker(t, t.plaza + 1, false);
  const pz = plazaZ(t.plaza);
  const zl = z - pz;
  if (zl > 40) return 'none';
  if (t.boomPlaza !== t.plaza) {
    t.boomBroken.fill(0);
    t.boomPlaza = t.plaza;
  }

  res.plaza = t.plaza;
  res.price = tollPrice(t.plaza);
  res.lane = Math.min(PLAZA_LANES - 1, Math.max(0, Math.floor(((car.minX + car.maxX) * 0.5) / P + PLAZA_LANES / 2)));

  local.minX = car.minX; local.maxX = car.maxX;
  local.minY = car.minY; local.maxY = car.maxY;
  local.minZ = car.minZ - pz; local.maxZ = car.maxZ - pz;

  if (!t.crashed) {
    for (let i = 0; i < plazaStaticBoxes.length; i++) {
      if (overlaps(local, plazaStaticBoxes[i])) {
        t.crashed = true;
        res.outcome = 'crash';
        return 'crash';
      }
    }
    // an island curb is only a scrape: push the car back out into its lane
    const cx = (local.minX + local.maxX) * 0.5;
    for (let i = 0; i < plazaIslandBoxes.length; i++) {
      const b = plazaIslandBoxes[i];
      if (!overlaps(local, b)) continue;
      const push = cx < (b.minX + b.maxX) * 0.5 ? b.minX - local.maxX : b.maxX - local.minX;
      if (Math.abs(push) > Math.abs(res.pushX)) res.pushX = push;
      res.curb = true;
    }
    if (res.curb && Math.abs(z - t.curbZ) > 3) {
      res.curbFresh = true;
      t.curbZ = z;
    }
  }

  const over = Math.abs(zl) <= PLAZA.canopyHalfDepth;
  if (over && car.minY < t.minYOver) t.minYOver = car.minY;

  // the boom line decides the toll outcome, in the driving direction (z decreasing)
  if (!t.tolled && prevZ - pz > PLAZA.boomZ && zl <= PLAZA.boomZ) {
    t.tolled = true;
    if (t.crashed) return 'none';
    if (over && t.minYOver >= PLAZA.flyoverY) {
      res.outcome = 'flyover';
      return 'flyover';
    }
    let rammed = false;
    let etc = false;
    for (let lane = 0; lane < PLAZA_LANES; lane++) {
      const arm = boomArms[lane];
      if (t.boomBroken[lane]) continue;
      if (local.minX < arm.maxX && local.maxX > arm.minX && local.minY < arm.maxY && local.maxY > arm.minY) {
        res.lane = lane;
        if (isEtcLane(t.plaza, lane)) {
          etc = true; // the boom lifts for ETC cars: a legal, paid pass
        } else {
          t.boomBroken[lane] = 1;
          rammed = true;
        }
      }
    }
    res.outcome = rammed ? 'ram' : etc ? 'etc' : 'jump';
    return res.outcome;
  }
  return 'none';
}
