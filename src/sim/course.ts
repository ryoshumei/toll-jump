// The course layout: where toll plazas and suction walls are, and how wide the road is at any z.
// Pure functions of z, shared by the sim, the toll logic and the renderers.
import { EXIT, PLAZA, ROAD } from '../config';

const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Z of the toll booths of plaza j (j = 0 is the first one, at 800 m). */
export const plazaZ = (j: number): number => -(PLAZA.first + PLAZA.spacing * j);

export function nearestPlaza(z: number): number {
  return Math.max(0, Math.round((-z - PLAZA.first) / PLAZA.spacing));
}

/** 0 on the open road, 1 inside the plaza, smooth in between. */
export function plazaTaper(z: number): number {
  const d = z - plazaZ(nearestPlaza(z)); // > 0 on the approach side
  if (d >= PLAZA.widenFrom) return 0;
  if (d > PLAZA.widenTo) return smooth((PLAZA.widenFrom - d) / (PLAZA.widenFrom - PLAZA.widenTo));
  if (d >= -PLAZA.narrowFrom) return 1;
  if (d > -PLAZA.narrowTo) return smooth((PLAZA.narrowTo + d) / (PLAZA.narrowTo - PLAZA.narrowFrom));
  return 0;
}

/** Inner face of the barriers (the car bounces off it). 4 lanes + 3 m shoulders, widening to 6 wide plaza lanes. */
export function roadHalfWidth(z: number): number {
  const t = plazaTaper(z);
  const edge = 2 * ROAD.laneW + (3 * ROAD.plazaPitch - 2 * ROAD.laneW) * t;
  return edge + ROAD.shoulder + (ROAD.plazaShoulder - ROAD.shoulder) * t;
}

/**
 * Lane lines l = -3..3. On the open road the 4-lane boundaries are l = -3 (edge), -1, 0, 1, 3 (edge) at
 * -7.5, -3.75, 0, 3.75, 7.5. The two extra lines l = +-2 are born in the middle of the outer lanes and fade in.
 * Inside the plaza every line sits at l * 6.7 (the island centres).
 */
const HIGHWAY_X = [-7.5, -5.625, -3.75, 0, 3.75, 5.625, 7.5];
export function laneLineX(l: number, z: number): number {
  const t = plazaTaper(z);
  const x0 = HIGHWAY_X[l + 3];
  return x0 + (l * ROAD.plazaPitch - x0) * t;
}
export const laneLineAlpha = (l: number, z: number): number => (Math.abs(l) === 2 ? plazaTaper(z) : 1);

/** Keep traffic out of the 150 m before a toll plaza (and the plaza), and around the arena exit ramp. */
export function trafficKeepOut(z: number): boolean {
  const d = z - plazaZ(nearestPlaza(z));
  if (d <= 190 && d >= -170) return true;
  const zz = exitZ(nearestExit(z));
  return z <= zz + 180 && z >= zz - EXIT.length - 80;
}

/** Pick a lane (0..3) for a new vehicle so that at least one lane stays clear. mask = lanes occupied nearby. -1 = no. */
export function pickLane(mask: number, r: number): number {
  let free = 0;
  for (let l = 0; l < 4; l++) if (!((mask >> l) & 1)) free++;
  if (free <= 1) return -1;
  let k = Math.min(free - 1, Math.floor(r * free));
  for (let l = 0; l < 4; l++) {
    if ((mask >> l) & 1) continue;
    if (k-- === 0) return l;
  }
  return -1;
}

/** Z where the arena exit ramp i leaves the highway (the ramp then runs EXIT.length further, toward -Z). */
export function exitZ(i: number): number {
  let dist = EXIT.first + EXIT.spacing * i;
  const j0 = nearestPlaza(-dist);
  for (let j = Math.max(0, j0 - 1); j <= j0 + 1; j++) {
    const dp = -plazaZ(j);
    if (dist >= dp - EXIT.keepBefore && dist <= dp + EXIT.keepAfter) {
      dist = dp - EXIT.keepBefore - 10;
      break;
    }
  }
  return -dist;
}

export function nearestExit(z: number): number {
  const guess = Math.max(0, Math.round((-z - EXIT.first) / EXIT.spacing));
  let best = guess;
  let bd = Infinity;
  for (let i = Math.max(0, guess - 1); i <= guess + 1; i++) {
    const d = Math.abs(exitZ(i) - z);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

export const exitGateZ = (i: number): number => exitZ(i) - EXIT.length;

/** Centre line of exit ramp i at z: it peels off the right lane and ends past the barrier. */
export function exitRampX(i: number, z: number): number {
  const u = Math.min(1, Math.max(0, (exitZ(i) - z) / EXIT.length));
  const x0 = 3 * ROAD.halfLane;
  const x1 = 2 * ROAD.laneW + ROAD.shoulder + EXIT.lateral;
  return x0 + (x1 - x0) * smooth(u);
}

/** How far past the barrier the car may go on the right: the ramp's outer edge. */
export function exitRightExtra(z: number): number {
  const i = nearestExit(z);
  const zz = exitZ(i);
  if (z > zz || z < zz - EXIT.length - 6) return 0;
  return Math.max(0, exitRampX(i, z) + EXIT.width / 2 - roadHalfWidth(z));
}

/** The opening in the right-hand barrier where the ramp leaves. */
export function exitGap(z: number): boolean {
  const zz = exitZ(nearestExit(z));
  return z <= zz + 6 && z >= zz - EXIT.length - 6;
}
