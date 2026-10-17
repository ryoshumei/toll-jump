import { describe, expect, it } from 'vitest';
import { KMH } from '../config';
import { addEtc, addNearMiss, addRoll, addStunt, addToll } from './score';
import { toggleSuction } from './suction';
import { createRun, resetRun, START_LIVES, START_SPEED } from './run';
import { forwardSpeed, stepVehicle } from './vehicle';
import { stepWall } from './wall';

const highway = { halfWidth: () => 14 };

/** Play a messy run on the real sim: fast, boosted, airborne, rolling, on the wall, scored, crashed, mid-fade. */
function dirty(run: ReturnType<typeof createRun>): number {
  const { veh, vin } = run;
  vin.throttle = 1;
  vin.boost = true;
  vin.steer = 0.6;
  for (let i = 0; i < 60 * 6; i++) stepVehicle(veh, vin, 1 / 60, highway, run.ev);
  vin.thrust = true;
  vin.roll = 1;
  for (let i = 0; i < 60 * 2; i++) { stepVehicle(veh, vin, 1 / 60, highway, run.ev); vin.roll = 0; }
  const peak = forwardSpeed(veh);
  veh.dir = -1; veh.heading = Math.PI; veh.flipping = true; veh.flipT = 0.4; veh.invuln = 1.2; veh.assist = 2; veh.righting = 0.3;
  veh.mode = 'wall'; veh.grounded = false; veh.suction = 1;
  run.wall.attached = true; run.wall.s = 20; run.wall.x = 2; run.wall.ds = 18; run.wall.cooldown = 0.4; run.wall.warn = true;
  stepWall(veh, run.wall, vin, true, 1 / 60, run.wev);
  toggleSuction(run.suction); run.suction.level = 0.8;
  addToll(run.score, 'jump', 45); addEtc(run.score, 45); addRoll(run.score); addNearMiss(run.score); addStunt(run.score);
  run.score.distance = 5400; run.score.crashes = 2; run.score.fines = 90;
  run.toll.plaza = 7; run.toll.tolled = true; run.toll.crashed = true; run.toll.minYOver = 3; run.toll.curbZ = -1234; run.toll.boomBroken[2] = 1; run.toll.boomPlaza = 7;
  run.tres.outcome = 'ram'; run.tres.lane = 3; run.tres.price = 45; run.tres.curb = true; run.tres.pushX = 0.4;
  run.place = 'arena';
  run.fade.phase = 2; run.fade.t = 0.7; run.fade.to = 'highway'; run.fade.speed = 31;
  run.lives = 1; run.overTimer = 0.8; run.stuntPending = true; run.newBest = true;
  return peak;
}

describe('a run', () => {
  it('starts rolling at 35 km/h at the origin with full lives, on the highway', () => {
    const run = createRun();
    expect(run.veh.z).toBe(0);
    expect(forwardSpeed(run.veh)).toBeCloseTo(START_SPEED, 9);
    expect(START_SPEED).toBeCloseTo(35 * KMH, 9);
    expect(run.lives).toBe(START_LIVES);
    expect(run.place).toBe('highway');
    expect(run.fade.phase).toBe(0);
    expect(run.veh.mode).toBe('free');
  });

  it('is really dirty after play (the test below is not vacuous)', () => {
    const run = createRun();
    expect(dirty(run)).toBeGreaterThan(100 * KMH);
    expect(run).not.toEqual(createRun());
  });

  it('a restart puts everything back: the state after a restart equals the initial state', () => {
    const run = createRun();
    dirty(run);
    resetRun(run);
    expect(run).toEqual(createRun());
  });

  it('restarts in place, so the objects other code holds stay valid', () => {
    const run = createRun();
    const { veh, wall, score, suction, toll, tres, fade, ev, wev, vin } = run;
    const boom = toll.boomBroken;
    dirty(run);
    resetRun(run);
    expect(run.veh).toBe(veh);
    expect(run.wall).toBe(wall);
    expect(run.score).toBe(score);
    expect(run.suction).toBe(suction);
    expect(run.toll).toBe(toll);
    expect(run.toll.boomBroken).toBe(boom);
    expect(run.tres).toBe(tres);
    expect(run.fade).toBe(fade);
    expect(run.ev).toBe(ev);
    expect(run.wev).toBe(wev);
    expect(run.vin).toBe(vin);
  });

  it('restarting twice, or restarting a fresh run, changes nothing', () => {
    const run = createRun();
    resetRun(run);
    expect(run).toEqual(createRun());
    dirty(run);
    resetRun(run);
    resetRun(run);
    expect(run).toEqual(createRun());
  });

  it('a restarted run plays like a new one (same drive, same result)', () => {
    const fresh = createRun();
    const again = createRun();
    dirty(again);
    resetRun(again);
    for (const r of [fresh, again]) {
      r.vin.throttle = 1;
      for (let i = 0; i < 60 * 4; i++) stepVehicle(r.veh, r.vin, 1 / 60, highway, r.ev);
    }
    expect(again.veh).toEqual(fresh.veh);
  });
});
