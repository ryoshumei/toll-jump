// Arcade vehicle step: drive, steer, gravity, thrust, gas, roll, bounds. Pure logic, no three.js.
import { CAR, PHYS, SUCTION, WALL } from '../config';

export interface VehicleInput {
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1 (right is +)
  thrust: boolean;
  boost: boolean;
  roll: number; // -1 | 0 | 1, a one-frame request
  detach: boolean; // one-frame pulse: Space pressed (used on the suction wall)
}

export interface VehicleWorld {
  halfWidth(z: number): number;
  /** Extra room on the +X side (an exit ramp leaving the highway). */
  rightExtra?(z: number): number;
}

export interface VehicleState {
  x: number;
  y: number; // altitude of the tire contact plane above the road
  z: number;
  vx: number;
  vy: number;
  vz: number; // negative = forward
  yaw: number;
  pitch: number; // may pass 90 degrees while on the suction wall
  roll: number;
  barrel: number; // barrel roll angle (rad), 0 when not rolling
  barrelDir: number;
  barrelT: number; // seconds into the current roll, 0 = not rolling
  rollCount: number;
  steer: number;
  gas: number; // 0..1 COPV
  gasLocked: boolean;
  thrustLevel: number; // smoothed 0..1
  boostLevel: number;
  burn: number; // landing burn level 0..1
  burnLatched: boolean;
  hoverHold: boolean;
  grounded: boolean;
  mode: 'free' | 'wall';
  airTime: number;
  invuln: number;
  righting: number; // seconds of RCS righting left after leaving the wall
  assist: number; // seconds of free thruster assist left (after a wall detach)
  gForce: number;
  latSpeed: number;
  dir: number; // +1 facing -Z (the highway direction), -1 after the stunt flip turned the car around
  heading: number; // 0 or PI: base yaw for rendering
  suction: number; // spooled suction level 0..1 (set by the game from the suction system)
  squat: number; // metres the car sinks on its suspension
  flipping: boolean;
  flipT: number;
  flipPitch0: number;
}

export interface StepEvents {
  landed: boolean;
  impactSpeed: number;
  landedMidRoll: boolean;
  barrierHit: boolean;
  barrierSpeed: number;
  rollStarted: boolean;
  rollCompleted: boolean;
  flipFinished: boolean;
  liftoff: boolean;
  burnStarted: boolean;
}

export function createVehicle(): VehicleState {
  return {
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    yaw: 0, pitch: 0, roll: 0,
    barrel: 0, barrelDir: 0, barrelT: 0, rollCount: 0,
    steer: 0, gas: 1, gasLocked: false,
    thrustLevel: 0, boostLevel: 0, burn: 0, burnLatched: false, hoverHold: false,
    grounded: true, mode: 'free', airTime: 0, invuln: 0, righting: 0, assist: 0,
    gForce: 1, latSpeed: 0,
    dir: 1, heading: 0, suction: 0, squat: 0, flipping: false, flipT: 0, flipPitch0: 0,
  };
}

export function createInput(): VehicleInput {
  return { throttle: 0, brake: 0, steer: 0, thrust: false, boost: false, roll: 0, detach: false };
}

export function createEvents(): StepEvents {
  return {
    landed: false, impactSpeed: 0, landedMidRoll: false, barrierHit: false, barrierSpeed: 0,
    rollStarted: false, rollCompleted: false, flipFinished: false, liftoff: false, burnStarted: false,
  };
}

export const forwardSpeed = (s: VehicleState): number => -s.vz * s.dir;

/** Start the automatic flip (RCS and thrusters): upside down -> right side up, and turned around. */
export function startFlip(s: VehicleState, pitch0: number): void {
  s.flipping = true;
  s.flipT = 0;
  s.flipPitch0 = pitch0;
  s.pitch = pitch0;
  s.roll = 0;
  s.yaw = 0;
}

function finishFlip(s: VehicleState, ev: StepEvents): void {
  s.flipping = false;
  s.flipT = 0;
  s.dir = -s.dir;
  s.heading = s.dir < 0 ? Math.PI : 0;
  s.pitch = 0;
  s.roll = 0;
  s.yaw = 0;
  s.steer = 0;
  ev.flipFinished = true;
}

// With a(v) = A0 (1 - (v/vmax)^2), v(t) = vmax tanh(A0 t / vmax): pick A0 so 0-100 km/h takes zeroTo100 seconds.
const V100 = 100 / 3.6;
export const A0 = (PHYS.topSpeed * Math.atanh(V100 / PHYS.topSpeed)) / PHYS.zeroTo100;
const VMAX_BOOST = PHYS.boostTopSpeed;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function clearEvents(ev: StepEvents): void {
  ev.landed = false; ev.impactSpeed = 0; ev.landedMidRoll = false; ev.barrierHit = false;
  ev.barrierSpeed = 0; ev.rollStarted = false; ev.rollCompleted = false; ev.liftoff = false;
  ev.burnStarted = false; ev.flipFinished = false;
}

/** Smooth drive acceleration (throttle + boost), forward positive. */
function driveAccel(f: number, thr: number, air: boolean, boosting: boolean): number {
  let a = 0;
  const vTop = boosting ? VMAX_BOOST : PHYS.topSpeed;
  if (thr > 0) a += thr * A0 * (1 - (f / vTop) ** 2) * (air ? PHYS.airThrottle : 1);
  if (boosting) a += PHYS.boostAccel * Math.max(0, 1 - (f / VMAX_BOOST) ** 2);
  return a;
}

/** Friction-like deceleration magnitude (rolling/air drag when coasting, plus brakes). */
function frictionDecel(f: number, thr: number, brake: number, air: boolean, hoverBrake: boolean): number {
  const coast = air ? PHYS.coastAir + PHYS.coastAirDrag * f * f : PHYS.coastGround + PHYS.coastDrag * f * f;
  const brakes = air ? (hoverBrake ? PHYS.hoverBrakeDecel : PHYS.airBrakeDecel) : PHYS.brakeDecel;
  return (1 - thr) * coast + brakes * brake;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Lift acceleration (m/s^2) at full thrust and altitude alt: 2.2 g up to 25 m, tapering to zero at 48 m. */
export function liftAccel(alt: number): number {
  const t = clamp(1 - (alt - PHYS.taperStart) / (PHYS.taperEnd - PHYS.taperStart), 0, 1);
  return PHYS.thrustAccel * t;
}

export function stepVehicle(
  s: VehicleState, i: VehicleInput, dt: number, w: VehicleWorld, ev: StepEvents,
): void {
  clearEvents(ev);
  if (s.invuln > 0) s.invuln = Math.max(0, s.invuln - dt);
  if (s.mode !== 'free') return;

  const air = !s.grounded;
  const gasOk = s.gas > 0 && !s.gasLocked;
  const playerThrust = i.thrust && gasOk;
  const wantThrust = playerThrust || s.assist > 0;
  const boosting = i.boost && gasOk;
  const hoverBrake = air && wantThrust && i.brake > 0.5; // S while thrusting: brake the forward speed hard
  const hoverHold = hoverBrake && s.y > 1.0; // ...and hold altitude, once the car has actually lifted off

  // --- thruster spool and gas (COPV) ---
  s.thrustLevel += ((wantThrust ? 1 : 0) - s.thrustLevel) * (1 - Math.exp(-(wantThrust ? 14 : 9) * dt));
  s.boostLevel += ((boosting ? 1 : 0) - s.boostLevel) * (1 - Math.exp(-(boosting ? 12 : 7) * dt));
  if (s.assist > 0) s.assist -= dt;
  if (playerThrust) s.gas -= PHYS.gasDrain * s.thrustLevel * dt;
  if (boosting) s.gas -= PHYS.boostDrain * dt;
  if (s.gas <= 0) { s.gas = 0; s.gasLocked = true; }
  if (s.grounded && !wantThrust && !boosting) s.gas = Math.min(1, s.gas + PHYS.gasRefill * dt);
  if (s.gasLocked && s.gas > PHYS.gasUnlock) s.gasLocked = false;

  // --- longitudinal (midpoint integration keeps it frame-rate independent) ---
  const d = s.dir;
  const f0 = -s.vz * d;
  const a1 = driveAccel(f0, i.throttle, air, boosting);
  const a2 = driveAccel(f0 + a1 * dt * 0.5, i.throttle, air, boosting);
  let f1 = f0 + a2 * dt;
  // friction acts against the motion and stops at zero (no reversing, no chatter)
  const dec = frictionDecel(f0, i.throttle, i.brake, air, hoverBrake) * dt;
  f1 = f1 > 0 ? Math.max(0, f1 - dec) : Math.min(0, f1 + dec);
  // after leaving the suction wall the car keeps its kick away from the wall through the descent (gentle damping);
  // on the ground a car cannot roll backward freely
  if (s.righting > 0 && f1 < 0) f1 *= Math.exp(-0.5 * dt);
  if (!air && f1 < 0) f1 = Math.min(0, f1 + 16 * dt);
  s.vz = -f1 * d;
  s.z -= 0.5 * (f0 + f1) * dt * d;
  const aLong = (f1 - f0) / dt;

  // --- lateral: steering smoothed toward the target, authority depends on speed ---
  const fAbs = Math.abs(f1);
  const sp = clamp(fAbs / PHYS.topSpeed, 0, 1);
  const thrusting = s.thrustLevel > 0.3;
  const grip = air ? (thrusting ? 1 : 0.55) : clamp(fAbs / 9, 0, 1);
  const sg = air ? 0 : s.suction; // suction only grips a surface
  const latMax = lerp(PHYS.latMaxLow, PHYS.latMaxHigh, Math.pow(sp, 0.7)) * (1 + SUCTION.gripSteer * sg * (0.4 + 0.6 * sp));
  const steerRate = lerp(PHYS.steerRateLow, PHYS.steerRateHigh, sp);
  s.steer += (i.steer - s.steer) * (1 - Math.exp(-steerRate * dt));
  const latAccel = air ? (thrusting ? PHYS.latAccelHover : PHYS.latAccelAir) : PHYS.latAccelGround * (1 + SUCTION.gripSlide * sg);
  s.vx += (s.steer * d * latMax * grip - s.vx) * (1 - Math.exp(-latAccel * dt));
  s.x += s.vx * dt;

  // --- bounds: stay inside the barriers and bounce off them ---
  const base = w.halfWidth(s.z) - CAR.halfW - PHYS.barrierMargin;
  const limR = base + (w.rightExtra ? w.rightExtra(s.z) : 0);
  if (s.x > limR || s.x < -base) {
    const side = s.x > 0 ? 1 : -1;
    const lim = side > 0 ? limR : base;
    const into = s.vx * side; // speed into the barrier
    s.x = side * lim;
    if (into > 0) {
      if (into > 1.5) {
        ev.barrierHit = true;
        ev.barrierSpeed = into;
        s.vz *= 1 - Math.min(0.05, into * 0.004);
      }
      s.vx = -s.vx * PHYS.barrierBounce;
      s.steer *= 0.3;
    }
  }

  // --- barrel roll: Q/E in the air, finishes on its own ---
  if (s.barrelT > 0) {
    s.barrelT += dt;
    const p = s.barrelT / PHYS.rollTime;
    if (p >= 1) {
      s.barrelT = 0;
      s.barrel = 0;
      s.rollCount++;
      ev.rollCompleted = true;
    } else {
      s.barrel = s.barrelDir * Math.PI * 2 * p * p * (3 - 2 * p);
    }
  } else if (i.roll !== 0 && air && s.y > PHYS.rollMinAlt) {
    s.barrelDir = i.roll > 0 ? -1 : 1; // E rolls right (clockwise seen from behind)
    s.barrelT = 1e-6;
    s.gas = Math.max(0, s.gas - PHYS.rollGasCost);
    ev.rollStarted = true;
  }

  // --- vertical: lift (with taper), hover hold, landing burn, gravity ---
  const alt = s.y;
  const liftMax = liftAccel(alt);
  let aThrust = liftMax * s.thrustLevel;
  s.hoverHold = false;
  if (hoverHold) {
    s.hoverHold = true; // altitude hold: cancel gravity and damp vertical speed
    aThrust = clamp(PHYS.gravity - PHYS.holdKp * s.vy, 0, liftMax) * s.thrustLevel;
  }

  let aBurn = 0;
  const h = Math.max(alt, 0.4);
  const avail = liftMax - PHYS.gravity; // net deceleration available at full burn
  const vt2 = PHYS.burnTouchSpeed * PHYS.burnTouchSpeed;
  if (air && !playerThrust && !s.burnLatched && s.vy < -PHYS.burnMinSpeed && avail > 0.5) {
    if ((s.vy * s.vy - vt2) / (2 * h) >= PHYS.burnEngage * avail) {
      s.burnLatched = true;
      ev.burnStarted = true;
    }
  }
  if (s.burnLatched) {
    if (!air || s.vy > -1) s.burnLatched = false;
    else aBurn = clamp(PHYS.gravity + Math.max(0, (s.vy * s.vy - vt2) / (2 * h)) * 1.08, 0, liftMax);
  }
  s.burn += ((s.burnLatched ? aBurn / PHYS.thrustAccel : 0) - s.burn) * (1 - Math.exp(-14 * dt));
  if (aBurn > aThrust) aThrust = aBurn;

  if (s.grounded) {
    if (aThrust - PHYS.gravity > 0.1) {
      s.grounded = false;
      s.airTime = 0;
      ev.liftoff = true;
    } else {
      s.y = 0;
      s.vy = 0;
    }
  }
  if (!s.grounded) {
    s.vy += (aThrust - PHYS.gravity) * dt;
    s.vy *= Math.exp(-PHYS.vDrag * dt);
    s.y += s.vy * dt;
    s.airTime += dt;
    if (s.y <= 0 && s.vy <= 0) {
      ev.landed = true;
      ev.impactSpeed = -s.vy;
      ev.landedMidRoll = s.barrelT > 0;
      if (s.flipping) finishFlip(s, ev); // landing before the turn is done completes it: no crash
      s.barrelT = 0;
      s.barrel = 0;
      s.y = 0;
      s.vy = 0;
      s.grounded = true;
      s.burnLatched = false;
    }
  }

  // --- visual attitude (frame-rate independent smoothing) ---
  if (s.righting > 0) s.righting = Math.max(0, s.righting - dt);
  if (s.flipping) {
    s.flipT += dt;
    const p = Math.min(1, s.flipT / WALL.flipTime);
    const e = p * p * (3 - 2 * p);
    s.pitch = s.flipPitch0 + (Math.PI - s.flipPitch0) * e; // nose over the top...
    s.roll = Math.PI * e; // ...while rolling upright: R = Rx(pitch) Rz(roll) ends as a half turn about Y
    s.yaw = 0;
    if (p >= 1) finishFlip(s, ev);
  } else {
    const rollT = clamp(-s.steer * 0.12, -0.2, 0.2);
    const yawT = clamp(-Math.atan2(s.vx * d, Math.max(fAbs, 8)) * 0.8, -0.25, 0.25);
    const pitchT = s.grounded ? clamp(aLong * 0.004, -0.06, 0.06) : clamp(s.vy * 0.012, -0.3, 0.3);
    const k = 1 - Math.exp(-9 * dt);
    s.roll += (rollT - s.roll) * k;
    s.yaw += (yawT - s.yaw) * k;
    s.pitch += (pitchT - s.pitch) * (1 - Math.exp(-8 * dt));
  }
  s.squat = s.grounded ? SUCTION.squat * s.suction : 0;

  // --- felt acceleration for the G-FORCE gauge (1.0 g = standing on the road) ---
  let ayS = s.grounded ? PHYS.gravity : aThrust;
  if (ev.landed) ayS += Math.min(ev.impactSpeed / dt, 6 * PHYS.gravity);
  const gT = clamp(Math.hypot(ayS, aLong) / PHYS.gravity, 0, 9.9);
  s.gForce += (gT - s.gForce) * (1 - Math.exp(-10 * dt));
}

/** A crash: speed drops sharply, the car hops, and it blinks invulnerable for a while. */
export function applyCrash(s: VehicleState): void {
  s.vz *= PHYS.crashSpeedKeep;
  s.vx *= 0.3;
  s.vy = Math.max(s.vy, 0) + 3.2;
  s.grounded = false;
  s.steer = 0;
  s.barrelT = 0;
  s.barrel = 0;
  s.burnLatched = false;
  s.invuln = PHYS.invuln;
}

/** Ramming a toll boom on the ground: slows the car, but it is not a crash. */
export function applyBoomHit(s: VehicleState): void {
  s.vz *= 0.72;
}
