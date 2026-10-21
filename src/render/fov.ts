// Screen-shape framing for the camera: pure functions, no THREE.
//
// The camera is tuned on a landscape screen: a vertical FOV of 60-75 degrees (28-52 in the cinematic views). Held
// upright, a phone is about 0.46 as wide as it is tall, and the same vertical FOV leaves a horizontal one of 30 degrees:
// you see your own lane and nothing else. So the design FOV is given to the *shorter* side of the screen instead (at
// least MIN_NARROW degrees of it: a 28 degree telephoto would be a slit); the camera backs off a little, and on the road
// it rises and looks nearer the car (a tall screen would otherwise be mostly sky). Everything here is the identity from a
// square screen up, so desktops and phones on their side are untouched.
const DEG = Math.PI / 180;

/** The widest vertical FOV a tall screen gets: past this the road edges and the sky stretch like a fisheye. */
export const MAX_VFOV = 95;
/** The least FOV the narrow side of a full portrait screen gets (degrees). */
const MIN_NARROW = 46;

/** At the full portrait shape: the camera is this much further back (a multiplier of 1 + this), this many metres higher
 *  on the road, and looks this much nearer the car (the look-ahead distance shrinks by this fraction). The lift is small
 *  on purpose: a toll canopy hangs 4.7 m over the road, and the camera drives under it. */
const PULL = 0.2;
const RAISE = 1;
const LOOK = 0.5;
/** The aspect (width / height) of a full portrait screen and below; each effect grows linearly from 0 at a square one. A
 *  phone held upright is about 0.46. */
const ASPECT_FULL = 0.5;

/** How upright the screen is: 0 from a square screen up (and for a nonsense aspect), 1 from ASPECT_FULL down. */
function upright(aspect: number): number {
  if (!(aspect > 0) || aspect >= 1) return 0;
  return Math.min(1, (1 - aspect) / (1 - ASPECT_FULL));
}

/** The vertical FOV (degrees) to render with, given the one the camera code animates (tuned for a landscape screen). */
export function fitFov(vFov: number, aspect: number): number {
  if (!(aspect > 0) || aspect >= 1) return vFov;
  const narrow = vFov + (Math.max(vFov, MIN_NARROW) - vFov) * upright(aspect); // the FOV the width gets
  const wide = 2 * Math.atan(Math.tan(narrow * DEG / 2) / aspect) / DEG;
  return Math.max(vFov, Math.min(MAX_VFOV, wide));
}

/** How far to move the camera back (a multiplier on its distance from the point it looks at). */
export const pullBack = (aspect: number): number => 1 + PULL * upright(aspect);

/** How much higher (metres) the camera on the road sits. */
export const raise = (aspect: number): number => RAISE * upright(aspect);

/** How far ahead of the car the road camera looks, as a multiplier of the distance it was tuned to. */
export const lookAhead = (aspect: number): number => 1 - LOOK * upright(aspect);
