// The stunt arena's wall: a curved road the car drives up. One circular arc: flat at ground level, vertical a
// quarter circle later, and 15 degrees past vertical, so the tip (about 20 m up) leans back over the approach.
//
// Staying on: with suction ON the fans hold the car, so it can stop and hang anywhere. With suction OFF it stays
// only while the surface pushes back hard enough (centripetal force must beat the pull of gravity), so a slow car
// falls off. Leaving the wall (Space, the tip, falling off) starts the automatic flip that turns the car around.
// Position and orientation come from the curve: the state is (s, x, ds/dt). Pure logic, no three.js.
import { PHYS, WALL } from '../config';
import { type Box, setBoxMinMax } from './collision';
import { startFlip, type VehicleInput, type VehicleState } from './vehicle';

const R = WALL.radius;
const G = PHYS.gravity;
export const WALL_LENGTH = R * WALL.angle;

export interface WallPose { z: number; y: number; theta: number }
export type DetachReason = '' | 'manual' | 'tip' | 'fell' | 'base';

export interface WallState {
  attached: boolean;
  s: number; // arc length along the curve
  x: number; // lateral offset from the ribbon centre
  ds: number; // ds/dt
  dx: number; // lateral speed
  downforce: number; // kN, for the HUD
  cooldown: number; // no re-attach for a moment after leaving
  settle: number; // eases the car's attitude onto the wall right after attaching
  warn: boolean; // suction off and about to fall
}

export interface WallEvents { attached: boolean; detached: boolean; reason: DetachReason }

export const createWallState = (): WallState =>
  ({ attached: false, s: 0, x: 0, ds: 0, dx: 0, downforce: 0, cooldown: 0, settle: 0, warn: false });
export const createWallEvents = (): WallEvents => ({ attached: false, detached: false, reason: '' });

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Surface point (relative to the wall start) and tangent angle at arc length s. */
export function wallPose(s: number, out: WallPose): WallPose {
  if (s <= 0) {
    out.z = -s + 0; out.y = 0; out.theta = 0; // before the start: flat tarmac
  } else {
    const th = Math.min(s, WALL_LENGTH) / R;
    out.theta = th;
    out.z = -R * Math.sin(th);
    out.y = R * (1 - Math.cos(th));
  }
  return out;
}

/** Height of the surface at distance zr past the start line (the climbing quarter of the arc). */
export function surfaceHeightAt(zr: number): number {
  const q = clamp(zr, 0, R);
  return R - Math.sqrt(R * R - q * q);
}

const P: WallPose = { z: 0, y: 0, theta: 0 };

/** Downforce (kN) the fans need to hold the car on the wall: most when hanging past vertical. */
export function wallDownforceKN(theta: number, ds: number): number {
  const gEff = G * (0.35 + Math.max(0, -Math.cos(theta)) + Math.abs(ds) / 80);
  return (1800 * gEff) / 1000;
}

function applyPose(v: VehicleState, w: WallState, dt: number, steer: number): void {
  wallPose(w.s, P);
  v.x = WALL.x + w.x;
  v.y = P.y;
  v.z = WALL.z + P.z;
  v.vx = w.dx;
  v.vy = w.ds * Math.sin(P.theta);
  v.vz = -w.ds * Math.cos(P.theta);
  if (w.settle > 0) {
    w.settle -= dt;
    v.pitch += (P.theta - v.pitch) * (1 - Math.exp(-16 * dt));
  } else {
    v.pitch = P.theta;
  }
  v.yaw += (0 - v.yaw) * (1 - Math.exp(-10 * dt));
  v.roll += (0 - v.roll) * (1 - Math.exp(-10 * dt));
  v.steer += (steer * 0.5 - v.steer) * (1 - Math.exp(-10 * dt));
  w.downforce = wallDownforceKN(P.theta, w.ds);
}

function attach(v: VehicleState, w: WallState, s: number, dx: number, ev: WallEvents): void {
  w.attached = true;
  w.s = Math.max(0, s);
  w.x = clamp(dx, -WALL.latLimit, WALL.latLimit);
  wallPose(w.s, P);
  w.ds = -v.vz * Math.cos(P.theta) + v.vy * Math.sin(P.theta); // velocity along the tangent
  w.dx = v.vx;
  w.settle = 0.35;
  w.warn = false;
  v.mode = 'wall';
  v.grounded = false;
  v.burnLatched = false;
  v.hoverHold = false;
  v.barrelT = 0;
  v.barrel = 0;
  v.assist = 0;
  v.righting = 0;
  v.thrustLevel = 0;
  v.boostLevel = 0;
  ev.attached = true;
}

/** Each step while free: the car drives onto the wall from the tarmac, or touches its surface. */
export function tryAttach(v: VehicleState, w: WallState, prevZ: number, ev: WallEvents): boolean {
  ev.attached = false;
  if (v.mode !== 'free' || w.cooldown > 0 || v.dir !== 1 || v.flipping) return false;
  const dx = v.x - WALL.x;
  if (Math.abs(dx) > WALL.latLimit + 0.55) return false;
  const dz = WALL.z - v.z; // > 0: past the start line, onto the wall
  if (dz < -2 || dz > R + 4) return false;

  if (v.y <= WALL.attachMaxY && prevZ > WALL.z && v.z <= WALL.z) {
    attach(v, w, dz, dx, ev);
    return true;
  }

  // contact with the surface (landing on it, or flying into it)
  if (v.y > 0.3) {
    let best = Infinity;
    let bs = 0;
    const N = 24;
    for (let i = 0; i <= N; i++) {
      const s = (i / N) * WALL_LENGTH;
      wallPose(s, P);
      const ez = v.z - (WALL.z + P.z);
      const ey = v.y - P.y;
      const d2 = ez * ez + ey * ey;
      if (d2 < best) { best = d2; bs = s; }
    }
    wallPose(bs, P);
    const nz = Math.sin(P.theta);
    const ny = Math.cos(P.theta);
    const d = (v.z - (WALL.z + P.z)) * nz + (v.y - P.y) * ny;
    const approach = -(v.vz * nz + v.vy * ny);
    if (d > -2.5 && d < 1.2 && approach > 1.0 && Math.sqrt(best) < 3.2) {
      attach(v, w, bs, dx, ev);
      return true;
    }
  }
  return false;
}

function detach(v: VehicleState, w: WallState, reason: DetachReason, ev: WallEvents): void {
  wallPose(w.s, P);
  const th = P.theta;
  const speed = clamp(w.ds, -8, reason === 'tip' ? WALL.tipCap : 10);
  const tip = reason === 'tip';
  const fell = reason === 'fell';
  const kz = fell ? 2 : tip ? WALL.tipKickZ : WALL.kickZ; // pushed back over the approach side
  const ky = fell ? 1 : tip ? WALL.tipKickY : WALL.kickY;
  v.vz = -speed * Math.cos(th) + kz;
  v.vy = speed * Math.sin(th) + ky;
  v.vx = w.dx;
  v.mode = 'free';
  v.grounded = false;
  v.assist = WALL.assistTime;
  v.righting = WALL.flipTime + 0.5;
  v.thrustLevel = 0.5;
  v.burnLatched = false;
  startFlip(v, th); // thrusters and RCS flip the car right side up and turn it around
  w.attached = false;
  w.cooldown = 0.7;
  w.ds = 0;
  w.warn = false;
  ev.detached = true;
  ev.reason = reason;
}

/** One step on the wall (or just the cooldown bookkeeping when not attached). */
export function stepWall(v: VehicleState, w: WallState, i: VehicleInput, suction: boolean, dt: number, ev: WallEvents): void {
  ev.detached = false;
  ev.reason = '';
  ev.attached = false;
  if (w.cooldown > 0) w.cooldown = Math.max(0, w.cooldown - dt);
  if (!w.attached) return;
  if (v.invuln > 0) v.invuln = Math.max(0, v.invuln - dt);
  v.gas = Math.min(1, v.gas + 0.2 * dt);
  v.gForce += (1 - v.gForce) * (1 - Math.exp(-6 * dt));

  if (i.detach) { detach(v, w, 'manual', ev); return; }

  wallPose(w.s, P);
  const th = P.theta;
  const want = i.throttle - i.brake;
  if (suction) {
    // the fans and brakes cancel gravity: W climbs, S descends, no throttle holds. Opposing input brakes hard.
    if (want !== 0) {
      const opposing = want * w.ds < 0;
      let a = opposing ? want * WALL.holdDecel : want > 0 ? want * WALL.accel : want * WALL.downAccel;
      if (a > 0 && w.ds >= WALL.maxUp) a = 0;
      if (a < 0 && w.ds <= -WALL.maxDown) a = 0;
      w.ds += a * dt;
    } else {
      const dec = WALL.holdDecel * dt;
      w.ds = Math.abs(w.ds) <= dec ? 0 : w.ds - Math.sign(w.ds) * dec;
    }
  } else {
    // no suction: gravity pulls the car back down the wall, and the wheels only grip as hard as the wall pushes
    const grip = Math.max(0, WALL.tractionMu * ((w.ds * w.ds) / R + G * Math.cos(th)));
    let a = -G * Math.sin(th);
    if (want > 0 && w.ds < WALL.maxUp) a += Math.min(WALL.accel * want, grip);
    else if (want < 0) a -= Math.min(WALL.downAccel * -want, grip);
    w.ds += a * dt;
  }
  w.ds = Math.max(w.ds, -WALL.maxDown);
  w.s += w.ds * dt;

  w.dx += (i.steer * WALL.latSpeed - w.dx) * (1 - Math.exp(-WALL.latAccel * dt));
  w.x += w.dx * dt;
  if (w.x > WALL.latLimit) { w.x = WALL.latLimit; if (w.dx > 0) w.dx = 0; }
  if (w.x < -WALL.latLimit) { w.x = -WALL.latLimit; if (w.dx < 0) w.dx = 0; }

  // without suction a slow car falls off: the normal acceleration (centripetal minus gravity's pull) runs out
  if (!suction) {
    wallPose(w.s, P);
    const nG = ((w.ds * w.ds) / R + G * Math.cos(P.theta)) / G;
    w.warn = nG < WALL.warnG;
    if (nG < WALL.fallOffG && w.s > 1.5) { detach(v, w, 'fell', ev); return; }
  } else {
    w.warn = false;
  }

  if (w.s <= 0) {
    if (w.ds <= 0) {
      // back down on the tarmac, stopped, nose toward the wall
      w.s = 0;
      v.mode = 'free';
      v.grounded = true;
      v.y = 0;
      v.z = WALL.z;
      v.x = WALL.x + w.x;
      v.vx = 0; v.vy = 0; v.vz = 0;
      v.pitch = 0;
      w.attached = false;
      w.cooldown = 0.7;
      w.ds = 0;
      w.warn = false;
      ev.detached = true;
      ev.reason = 'base';
      return;
    }
    w.s = 0;
  } else if (w.s >= WALL_LENGTH) {
    if (w.ds > WALL.tipLeaveSpeed) {
      w.s = WALL_LENGTH;
      applyPose(v, w, dt, i.steer); // upside down at the tip, nose up and back...
      detach(v, w, 'tip', ev); // ...and off it goes
      return;
    }
    w.s = WALL_LENGTH;
    if (w.ds > 0) w.ds = 0;
  }
  applyPose(v, w, dt, i.steer);
}

/** Collision boxes of the rails and the truss behind the wall. Returns how many were written. */
export function wallFrameBoxes(out: Box[]): number {
  let n = 0;
  const edges = [0, 3, 6, 9, 12, 15.6];
  for (const side of [-1, 1]) {
    const xa = WALL.x + side * WALL.halfWidth;
    const xb = WALL.x + side * WALL.railHalf;
    for (let k = 0; k < edges.length - 1; k++) {
      setBoxMinMax(out[n++], Math.min(xa, xb), 0, WALL.z - edges[k + 1], Math.max(xa, xb), surfaceHeightAt(edges[k + 1]) + 0.3, WALL.z - edges[k]);
    }
    setBoxMinMax(out[n++], Math.min(xa, xb), 0, WALL.z - R - 0.3, Math.max(xa, xb), WALL_LENGTH, WALL.z - 15.0);
  }
  setBoxMinMax(out[n++], WALL.x - WALL.railHalf, 0, WALL.z - R - 0.3 - WALL.frameDepth, WALL.x + WALL.railHalf, 21, WALL.z - R + 0.3);
  return n;
}
