// The car's own suction (吸附) system: underbody fans, toggled with F. Pure logic, no three.js.
// On the road: more grip, a few cm of squat. On the wall: it is what lets the car climb slowly, stop and hang.
// In the air it does nothing, because there is no surface.
import { CAR, PHYS, SUCTION } from '../config';

export interface SuctionState {
  on: boolean;
  level: number; // 0..1, the fans spooling up and down
}

export const createSuction = (): SuctionState => ({ on: false, level: 0 });

export function toggleSuction(s: SuctionState): boolean {
  s.on = !s.on;
  return s.on;
}

export function stepSuction(s: SuctionState, dt: number): void {
  s.level += ((s.on ? 1 : 0) - s.level) * (1 - Math.exp(-(s.on ? 7 : 5) * dt));
  if (!s.on && s.level < 0.001) s.level = 0;
}

/** The fans have spooled up enough to hold the car against a surface. */
export const suctionActive = (s: SuctionState): boolean => s.on && s.level > 0.55;

export const steerGrip = (level: number): number => 1 + SUCTION.gripSteer * level;
export const slideGrip = (level: number): number => 1 + SUCTION.gripSlide * level;
export const squatMeters = (level: number): number => SUCTION.squat * level;

/** Downforce readout in kN: zero when off; a base hold plus an aero-like term that grows with speed. */
export function downforceKN(level: number, speed: number): number {
  return (level * (CAR.mass * PHYS.gravity * SUCTION.holdG + SUCTION.dragK * speed * speed)) / 1000;
}
