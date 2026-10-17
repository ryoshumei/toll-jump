// All tunables live here. Units: meters, seconds, radians unless noted. Y up, the car drives toward -Z.

export const G0 = 9.80665;
export const KMH = 1 / 3.6; // m/s per km/h

export const CAR = {
  length: 4.4,
  width: 2.0,
  height: 1.15,
  wheelbase: 2.65,
  wheelRadius: 0.36,
  track: 1.7,
  halfW: 0.95, // collision half width (a little forgiving)
  halfL: 2.15,
  boxHeight: 1.1,
  mass: 1800,
};

export const PHYS = {
  gravity: 1.6 * G0, // arcade gravity, 1.6 g
  thrustAccel: 2.2 * G0, // lift at full thrust, 2.2 g
  taperStart: 25, // lift starts to fade above this altitude (m)
  taperEnd: 48, // and is gone here
  vDrag: 0.22, // vertical air drag (1/s): settles the hover
  topSpeed: 320 * KMH,
  boostTopSpeed: 380 * KMH,
  zeroTo100: 2.2, // seconds
  boostAccel: 22, // rear boost jets push hard
  brakeDecel: 30,
  airBrakeDecel: 7,
  hoverBrakeDecel: 26, // S while thrusting in the air
  holdKp: 3.2, // altitude hold gain for the hover brake (1/s)
  airThrottle: 0.45,
  coastGround: 0.9,
  coastDrag: 0.0006,
  coastAir: 0.15,
  coastAirDrag: 0.0002,
  // steering
  latMaxLow: 13,
  latMaxHigh: 8.5,
  steerRateLow: 15,
  steerRateHigh: 7.5,
  latAccelGround: 6.5,
  latAccelAir: 2.4,
  latAccelHover: 4.2,
  // gas (COPV)
  gasDrain: 0.22, // per second at full thrust
  boostDrain: 0.17,
  rollGasCost: 0.035,
  gasRefill: 0.3, // per second on the ground
  gasUnlock: 0.12,
  // barrel roll
  rollTime: 0.8,
  rollMinAlt: 0.8,
  // landing burn
  burnTouchSpeed: 3.5,
  burnEngage: 0.78,
  burnMinSpeed: 6,
  // bounds
  barrierBounce: 0.35,
  barrierMargin: 0.12,
  // crash
  crashSpeedKeep: 0.32,
  invuln: 2.0,
};

export const ROAD = {
  laneW: 3.75,
  lanes: 4,
  halfLane: 1.875, // half of a lane: 'pitch' at t=0
  shoulder: 3.0,
  plazaPitch: 6.7, // 6 lanes inside the plaza: 5.5 m openings plus 1.2 m islands
  plazaShoulder: 1.5,
  chunkLen: 120,
  rowLen: 10,
  fogFar: 420,
};

export const PLAZA = {
  first: 800,
  spacing: 2000,
  widenFrom: 220, // distance before the plaza centre where the road starts to widen
  widenTo: 70,
  narrowFrom: 50, // distance after the centre where it starts to narrow
  narrowTo: 150,
  canopyHalfDepth: 10,
  canopyUnder: 6,
  canopyTop: 7,
  valanceBottom: 4.7,
  canopyHalfWidth: 21.9,
  islandHalfLen: 12,
  islandHalfWidth: 0.6, // 1.2 m wide islands
  islandHitHalf: 0.5, // hitboxes are a little smaller than the visuals
  islandHeight: 0.3,
  boothHalfLen: 1.7,
  boothHitHalfLen: 1.55,
  boothHalfWidth: 0.6,
  boothHitHalfWidth: 0.5,
  boothHeight: 2.7,
  boomZ: 2.6, // boom line, in front (approach side) of the booths
  boomY0: 0.85,
  boomY1: 1.12,
  pillarZ: 6.6,
  pillarHalf: 0.45,
  pillarHitHalf: 0.38,
  pillarHeight: 6,
  flyoverY: 7.5,
  basePrice: 45,
  priceStep: 5,
  fine: 200,
  signFar: 500,
  signEtc: 250,
};

// The stunt arena's wall (arena coordinates). One circular arc: flat at ground level, up through vertical, and
// 15 degrees past it, so the tip (about 20 m up) leans back over the approach.
export const WALL = {
  z: -60, // where the wall starts, flush with the tarmac
  x: 0,
  radius: 15.9,
  angle: (105 * Math.PI) / 180,
  halfWidth: 3.5, // about 7 m wide
  railHalf: 3.8,
  latLimit: 2.3, // car centre limit from the ribbon centre
  attachMaxY: 0.9,
  accel: 17,
  downAccel: 20,
  holdDecel: 70,
  maxUp: 26,
  maxDown: 14,
  latSpeed: 7.5,
  latAccel: 9,
  tipLeaveSpeed: 0.8, // driving off the tip needs at least this speed
  tipCap: 16,
  kickZ: 8, // push off the surface toward +Z (the approach side)...
  kickY: 7, // ...and up, so even a detach at the base has time to flip
  tipKickZ: 5,
  tipKickY: 0.5,
  flipTime: 1.2, // upside down -> right side up, and turned around
  assistTime: 1.5, // thrusters fire (free gas) through the flip and the first hover
  frameDepth: 4.2,
  tractionMu: 1.1, // without suction the wheels only grip as hard as the surface pushes back
  fallOffG: 0.12, // normal acceleration (in g) below which a car without suction leaves the wall
  warnG: 0.5, // ...and the HUD warns below this
};

export const ARENA = {
  halfX: 56,
  spawnZ: 150, // where the car appears (heading -Z)
  gateZ: 158, // driving out through the gate (heading +Z) fades back to the highway
  speedLimit: 40, // m/s, so the tip launch stays a stunt and not a rocket
  zMin: -110,
};

export const EXIT = {
  first: 1500,
  spacing: 3000,
  keepBefore: 700,
  keepAfter: 350,
  length: 90, // the ramp runs this far, then the gate
  width: 5.4,
  lateral: 12, // how far past the barrier the ramp ends up
  signFar: 1000,
  signNear: 500,
  mergeBack: 150, // on return the car joins the highway this far past the exit
};

export const SUCTION = {
  gripSteer: 0.3, // sharper steering at speed
  gripSlide: 0.5, // less slide
  squat: 0.035, // metres
  holdG: 0.35,
  dragK: 1.1,
};

export const SCORE = {
  perMeter: 1,
  airPerSecond: 100,
  roll: 500,
  nearMiss: 100,
  flyover: 5000,
  jump: 1500,
  ram: -300,
  stunt: 2500,
  nearMissGap: 1.0,
  nearMissMinSpeed: 22,
};

export const TRAFFIC = {
  sedans: 9, // about half the first version's density
  semis: 1, // and Semis are rare
  ahead: 430,
  behind: 45,
  minSpeed: 17,
  maxSpeed: 33,
  semiSpeed: 24,
  sedan: { hx: 0.92, hy: 0.72, hz: 2.25 },
  semi: { hx: 1.3, hy: 2.0, hz: 8.1 },
};

// Nozzle mount points in the car's local frame (origin on the ground plane, nose toward -Z).
export const NOZZLES = {
  down: [
    [-0.7, 0.16, -1.325], // FL
    [0.7, 0.16, -1.325], // FR
    [-0.7, 0.16, 1.325], // RL
    [0.7, 0.16, 1.325], // RR
  ] as [number, number, number][],
  rear: [
    [-0.55, 0.36, 2.17],
    [0.55, 0.36, 2.17],
  ] as [number, number, number][],
  rcs: [
    [-1.0, 0.56, -1.55], // L front
    [-1.0, 0.56, 1.55], // L rear
    [1.0, 0.56, -1.55], // R front
    [1.0, 0.56, 1.55], // R rear
  ] as [number, number, number][],
};

// GLB car (public/models/roadster.glb). Names follow docs/CAR_MODEL.md.
export const GLB = {
  url: 'models/roadster.glb',
  targetLength: 4.4,
  rotationY: 0, // extra yaw (rad) applied on top of auto-orientation
  probeTimeoutMs: 2500,
};

export const CAMERA = {
  fovMin: 60,
  fovMax: 75,
  boostKick: 10,
  distGround: 7.2,
  heightGround: 2.55,
  distAir: 12.5,
  heightAir: 6.6,
};

export const QUALITY = {
  low: { dprCap: 1.0, shadow: 1024, particles: 1400, bloom: 0.5, msaa: 2 },
  normal: { dprCap: 1.5, shadow: 1024, particles: 2500, bloom: 1, msaa: 4 },
  high: { dprCap: 2.0, shadow: 2048, particles: 2500, bloom: 1, msaa: 4 },
};
