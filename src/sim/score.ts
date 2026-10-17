// Scoring: pure state and functions. Persistence takes an injectable storage so it stays testable.
import { SCORE } from '../config';

export interface Score {
  distance: number;
  airTime: number;
  rolls: number;
  nearMisses: number;
  flyovers: number;
  jumps: number;
  rams: number;
  saved: number; // 累计逃费 in yuan
  fines: number;
  bonus: number;
  crashes: number;
  stunts: number;
  etcPasses: number;
  etcPaid: number;
}

export type TollKind = 'flyover' | 'jump' | 'ram';
export interface StorageLike { getItem(k: string): string | null; setItem(k: string, v: string): void }

export const BEST_KEY = 'flying-roadster.best';

export function createScore(): Score {
  return { distance: 0, airTime: 0, rolls: 0, nearMisses: 0, flyovers: 0, jumps: 0, rams: 0, saved: 0, fines: 0, bonus: 0, crashes: 0, stunts: 0, etcPasses: 0, etcPaid: 0 };
}
export function addDistance(s: Score, meters: number): void {
  if (meters > 0) s.distance += meters;
}

export function addAirTime(s: Score, dt: number): void {
  if (dt > 0) s.airTime += dt;
}

export function addRoll(s: Score): number {
  s.rolls++;
  return SCORE.roll;
}

export function addNearMiss(s: Score): number {
  s.nearMisses++;
  return SCORE.nearMiss;
}

/** Apply a toll outcome. Returns the score points it is worth (negative for a fine). */
export function addToll(s: Score, kind: TollKind, price: number, fine = 200): number {
  if (kind === 'flyover') {
    s.flyovers++;
    s.saved += price;
    s.bonus += SCORE.flyover;
    return SCORE.flyover;
  }
  if (kind === 'jump') {
    s.jumps++;
    s.saved += price;
    s.bonus += SCORE.jump;
    return SCORE.jump;
  }
  s.rams++;
  s.fines += fine;
  s.bonus += SCORE.ram;
  return SCORE.ram;
}

/** An ETC pass is paid: no bonus, no penalty, nothing saved. */
export function addEtc(s: Score, price: number): number {
  s.etcPasses++;
  s.etcPaid += price;
  return 0;
}

/** The arena stunt: up the wall, off the tip, flip, turn around, land. */
export function addStunt(s: Score): number {
  s.stunts++;
  s.bonus += SCORE.stunt;
  return SCORE.stunt;
}

export const tollsSkipped = (s: Score): number => s.flyovers + s.jumps;

export function totalScore(s: Score): number {
  const raw = s.distance * SCORE.perMeter + s.airTime * SCORE.airPerSecond + s.rolls * SCORE.roll
    + s.nearMisses * SCORE.nearMiss + s.bonus;
  return Math.max(0, Math.floor(raw));
}

function defaultStorage(): StorageLike | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined;
  } catch {
    return undefined;
  }
}

export function loadBest(st: StorageLike | undefined = defaultStorage()): number {
  try {
    const v = Number(st?.getItem(BEST_KEY));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  } catch {
    return 0;
  }
}

export function saveBest(n: number, st: StorageLike | undefined = defaultStorage()): void {
  try {
    if (n > loadBest(st)) st?.setItem(BEST_KEY, String(Math.floor(n)));
  } catch {
    /* storage unavailable: the best score just isn't remembered */
  }
}
