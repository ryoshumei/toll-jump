// One run's state in one place. A start and a restart both go through createRun() / resetRun(), so a restart is by
// construction a fresh start: nothing a run touched (speed, score, lives, suction, wall, toll, arena, fade) survives it.
import { KMH } from '../config';
import { createScore, type Score } from './score';
import { createSuction, type SuctionState } from './suction';
import { createTollResult, createTollTracker, resetTollTracker, type TollResult, type TollTracker } from './toll';
import { createEvents, createInput, createVehicle, type StepEvents, type VehicleInput, type VehicleState } from './vehicle';
import { createWallEvents, createWallState, type WallEvents, type WallState } from './wall';

export type Place = 'highway' | 'arena';

/** A run starts rolling at 35 km/h. */
export const START_SPEED = 35 * KMH;
export const START_LIVES = 3;

/** The highway <-> arena fade. phase: 0 idle, 1 fading out, 2 holding the card, 3 fading in. */
export interface FadeState {
  phase: number;
  t: number;
  to: Place;
  speed: number; // the car's speed carried across the switch
}

export interface RunState {
  veh: VehicleState;
  wall: WallState;
  wev: WallEvents;
  ev: StepEvents;
  vin: VehicleInput;
  score: Score;
  suction: SuctionState;
  toll: TollTracker;
  tres: TollResult;
  fade: FadeState;
  place: Place;
  lives: number;
  overTimer: number; // > 0 while the last crash plays out before the game over screen
  stuntPending: boolean;
  newBest: boolean;
}

const createFade = (): FadeState => ({ phase: 0, t: 0, to: 'arena', speed: 0 });

export function createRun(): RunState {
  const veh = createVehicle();
  veh.vz = -START_SPEED;
  return {
    veh,
    wall: createWallState(),
    wev: createWallEvents(),
    ev: createEvents(),
    vin: createInput(),
    score: createScore(),
    suction: createSuction(),
    toll: createTollTracker(),
    tres: createTollResult(),
    fade: createFade(),
    place: 'highway',
    lives: START_LIVES,
    overTimer: 0,
    stuntPending: false,
    newBest: false,
  };
}

/** Put a run back to its initial state, in place (the game and the renderers hold references to these objects). */
export function resetRun(run: RunState): void {
  const f = createRun();
  Object.assign(run.veh, f.veh);
  Object.assign(run.wall, f.wall);
  Object.assign(run.wev, f.wev);
  Object.assign(run.ev, f.ev);
  Object.assign(run.vin, f.vin);
  Object.assign(run.score, f.score);
  Object.assign(run.suction, f.suction);
  Object.assign(run.tres, f.tres);
  Object.assign(run.fade, f.fade);
  resetTollTracker(run.toll, 0); // also clears the broken booms, keeping the same array
  run.place = f.place;
  run.lives = f.lives;
  run.overTimer = f.overTimer;
  run.stuntPending = f.stuntPending;
  run.newBest = f.newBest;
}
