import { describe, expect, it } from 'vitest';
import {
  addAirTime, addDistance, addEtc, addNearMiss, addRoll, addStunt, addToll, createScore, loadBest, saveBest,
  totalScore, type StorageLike,
} from './score';

describe('scoring', () => {
  it('gives +1 per meter of distance', () => {
    const s = createScore();
    addDistance(s, 250);
    expect(totalScore(s)).toBe(250);
  });

  it('gives +100 per second of air time', () => {
    const s = createScore();
    addAirTime(s, 1.5);
    expect(totalScore(s)).toBe(150);
  });

  it('gives +500 per roll and +100 per near miss, and returns the points', () => {
    const s = createScore();
    expect(addRoll(s)).toBe(500);
    expect(addNearMiss(s)).toBe(100);
    expect(totalScore(s)).toBe(600);
    expect(s.rolls).toBe(1);
    expect(s.nearMisses).toBe(1);
  });

  it('adds everything up and floors to an integer', () => {
    const s = createScore();
    addDistance(s, 100.9);
    addAirTime(s, 0.5);
    expect(totalScore(s)).toBe(150);
  });
});

describe('ETC passes', () => {
  it('are paid, with no bonus, no penalty and no yuan saved', () => {
    const s = createScore();
    addDistance(s, 100);
    expect(addEtc(s, 45)).toBe(0);
    expect(s.etcPasses).toBe(1);
    expect(s.etcPaid).toBe(45);
    expect(s.saved).toBe(0);
    expect(s.fines).toBe(0);
    expect(totalScore(s)).toBe(100);
  });
});

describe('stunt scoring', () => {
  it('completing the arena stunt is worth 2500 and is counted', () => {
    const s = createScore();
    expect(addStunt(s)).toBe(2500);
    expect(s.stunts).toBe(1);
    expect(totalScore(s)).toBe(2500);
  });
});

describe('toll scoring and the running 累计逃费 total', () => {
  it('flying over the canopy is the big bonus and saves the toll', () => {
    const s = createScore();
    const pts = addToll(s, 'flyover', 45);
    expect(pts).toBeGreaterThan(addToll(createScore(), 'jump', 45));
    expect(s.saved).toBe(45);
    expect(s.flyovers).toBe(1);
  });

  it('jumping the boom saves the toll too', () => {
    const s = createScore();
    addToll(s, 'jump', 50);
    expect(s.saved).toBe(50);
    expect(s.jumps).toBe(1);
  });

  it('ramming the boom is a 200 yuan fine, saves nothing, and costs a few points', () => {
    const s = createScore();
    addDistance(s, 1000);
    const pts = addToll(s, 'ram', 45);
    expect(pts).toBeLessThan(0);
    expect(s.fines).toBe(200);
    expect(s.saved).toBe(0);
    expect(s.rams).toBe(1);
    expect(totalScore(s)).toBeLessThan(1000);
  });

  it('keeps a running total over several plazas', () => {
    const s = createScore();
    addToll(s, 'flyover', 45);
    addToll(s, 'jump', 50);
    addToll(s, 'flyover', 55);
    expect(s.saved).toBe(150);
  });

  it('never lets the total go below zero', () => {
    const s = createScore();
    addToll(s, 'ram', 45);
    expect(totalScore(s)).toBe(0);
  });
});

describe('best score persistence', () => {
  const mem = (init?: string): StorageLike & { v: string | null } => ({
    v: init ?? null,
    getItem() { return this.v; },
    setItem(_k: string, v: string) { this.v = v; },
  });
  const broken: StorageLike = {
    getItem() { throw new Error('denied'); },
    setItem() { throw new Error('denied'); },
  };

  it('reads 0 when nothing is stored or the value is junk', () => {
    expect(loadBest(mem())).toBe(0);
    expect(loadBest(mem('abc'))).toBe(0);
  });

  it('saves a new best and only ever raises it', () => {
    const st = mem();
    saveBest(1200, st);
    expect(loadBest(st)).toBe(1200);
    saveBest(800, st);
    expect(loadBest(st)).toBe(1200);
    saveBest(3000, st);
    expect(loadBest(st)).toBe(3000);
  });

  it('survives a storage that throws', () => {
    expect(() => saveBest(10, broken)).not.toThrow();
    expect(loadBest(broken)).toBe(0);
  });
});
