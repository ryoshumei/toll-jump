// AABB helpers for traffic, semis, booths, pillars and the wall frame. Pure logic, no three.js.
import { CAR, SCORE } from '../config';

export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

export const makeBox = (): Box => ({ minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 });

/** Set a box from its centre and half extents. */
export function setBox(b: Box, cx: number, cy: number, cz: number, hx: number, hy: number, hz: number): Box {
  b.minX = cx - hx; b.maxX = cx + hx;
  b.minY = cy - hy; b.maxY = cy + hy;
  b.minZ = cz - hz; b.maxZ = cz + hz;
  return b;
}

/** Set a box from its min and max corners. */
export function setBoxMinMax(
  b: Box, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): Box {
  b.minX = x0; b.minY = y0; b.minZ = z0; b.maxX = x1; b.maxY = y1; b.maxZ = z1;
  return b;
}

/** Strict overlap: touching faces do not count. */
export function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX
    && a.minY < b.maxY && a.maxY > b.minY
    && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

const axisGap = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  aMax < bMin ? bMin - aMax : bMax < aMin ? aMin - bMax : 0;

/** Straight-line distance between two boxes (0 when they overlap or touch). */
export function boxGap(a: Box, b: Box): number {
  const dx = axisGap(a.minX, a.maxX, b.minX, b.maxX);
  const dy = axisGap(a.minY, a.maxY, b.minY, b.maxY);
  const dz = axisGap(a.minZ, a.maxZ, b.minZ, b.maxZ);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Gap in the x/y plane, only when the boxes overlap along z (the car is alongside).
 * Infinity when one is still ahead of the other.
 */
export function sideGap(a: Box, b: Box): number {
  if (a.minZ >= b.maxZ || a.maxZ <= b.minZ) return Infinity;
  const dx = axisGap(a.minX, a.maxX, b.minX, b.maxX);
  const dy = axisGap(a.minY, a.maxY, b.minY, b.maxY);
  return Math.sqrt(dx * dx + dy * dy);
}

/** The player's car box. y is the altitude of the tire contact plane. */
export function carBox(out: Box, x: number, y: number, z: number): Box {
  return setBoxMinMax(out, x - CAR.halfW, y, z - CAR.halfL, x + CAR.halfW, y + CAR.boxHeight, z + CAR.halfL);
}

/** A close pass within 1 m at speed, alongside the obstacle and not touching it. */
export function isNearMiss(car: Box, obstacle: Box, speed: number): boolean {
  if (speed < SCORE.nearMissMinSpeed) return false;
  const g = sideGap(car, obstacle);
  return g > 0 && g < SCORE.nearMissGap;
}
