// Keyboard (and optional touch) input. Game keys call preventDefault and every key is cleared on blur.

import { TOUCH } from '../config';

/** Touch mode's own throttle at forward speed fwd (m/s): a gentle launch that eases off toward the cruise speed, so a
 *  phone player is not flooring it to 320 km/h. BOOST still goes past the cruise speed. */
export function cruiseThrottle(fwd: number): number {
  return Math.min(TOUCH.maxThrottle, Math.max(0, (TOUCH.cruise - fwd) / TOUCH.cruiseBand));
}

/** [throttle, brake]. Touch mode drives forward by itself (see cruiseThrottle), so it has no "neither pedal" state; on
 *  the arena wall it climbs at full throttle, and its brake holds the car where it is (with suction on) instead of
 *  backing it down. Outside touch mode S still descends. */
export function pedals(up: boolean, down: boolean, auto: boolean, onWall: boolean, fwd = 0): [number, number] {
  if (auto && onWall && down && !up) return [0, 0];
  const self = auto && !down ? (onWall ? 1 : cruiseThrottle(fwd)) : 0;
  return [up ? 1 : self, down ? 1 : 0];
}

export class Input {
  throttle = 0;
  brake = 0;
  brakeLight = 0; // the brake pedal itself: lit even while a touch brake holds the car on the wall (brake = 0)
  steer = 0;
  boost = false;
  /** Debug override for the thrusters (null = follow the keyboard). */
  forceThrust: boolean | null = null;
  autoThrottle = false; // touch mode drives forward by itself
  onWall = false; // set by the game every frame (see pedals)
  fwd = 0; // forward speed (m/s), likewise: touch mode cruises (see cruiseThrottle)

  // one-frame pulses, consumed by the game
  rollPulse = 0;
  detachPulse = false;
  cameraPulse = false;
  pausePulse = false;
  mutePulse = false;
  restartPulse = false;
  startPulse = false;
  suctionPulse = false;
  langPulse = false;
  anyKey = false; // first user gesture (audio unlock)

  private keys = new Set<string>();
  private held = new Set<string>(); // keys that were already down when a run (re)started: ignored until released
  private touch = { left: false, right: false, thrust: false, boost: false, brake: false };
  private prevThrust = false;

  constructor(target: Window) {
    target.addEventListener('keydown', (e) => this.down(e));
    target.addEventListener('keyup', (e) => this.up(e));
    target.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
  }

  private static GAME_KEYS = new Set([
    'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
    'KeyQ', 'KeyE', 'KeyC', 'Escape', 'KeyM', 'KeyR', 'Enter', 'Tab', 'KeyF', 'KeyL',
  ]);

  private down(e: KeyboardEvent): void {
    if (Input.GAME_KEYS.has(e.code)) e.preventDefault();
    this.anyKey = true;
    if (e.repeat) return;
    this.keys.add(e.code);
    this.held.delete(e.code);
    switch (e.code) {
      case 'KeyQ': this.rollPulse = -1; break;
      case 'KeyE': this.rollPulse = 1; break;
      case 'KeyC': this.cameraPulse = true; break;
      case 'Escape': this.pausePulse = true; break;
      case 'KeyM': this.mutePulse = true; break;
      case 'KeyR': this.restartPulse = true; break;
      case 'Enter': this.startPulse = true; break;
      case 'Space': this.detachPulse = true; break;
      case 'KeyF': this.suctionPulse = true; break;
      case 'KeyL': this.langPulse = true; break;
    }
  }

  private up(e: KeyboardEvent): void {
    if (Input.GAME_KEYS.has(e.code)) e.preventDefault();
    this.keys.delete(e.code);
    this.held.delete(e.code);
  }

  private isDown(code: string): boolean {
    return this.keys.has(code) && !this.held.has(code);
  }

  /** Called at every (re)start: whatever is held now (W, Shift, Space...) is ignored until it is let go and pressed again. */
  releaseHeld(): void {
    for (const k of this.keys) this.held.add(k);
    this.poll(); // this frame was already polled with those keys down
  }

  clear(): void {
    this.keys.clear();
    this.held.clear();
    this.touch.left = this.touch.right = this.touch.thrust = this.touch.boost = this.touch.brake = false;
  }

  /** Refresh throttle / brake / steer / boost from the held keys. Returns thrust (level). */
  poll(): boolean {
    const t = this.touch;
    const up = this.isDown('KeyW') || this.isDown('ArrowUp');
    const down = this.isDown('KeyS') || this.isDown('ArrowDown') || t.brake;
    [this.throttle, this.brake] = pedals(up, down, this.autoThrottle, this.onWall, this.fwd);
    this.brakeLight = down ? 1 : 0;
    const l = this.isDown('KeyA') || this.isDown('ArrowLeft') || t.left;
    const r = this.isDown('KeyD') || this.isDown('ArrowRight') || t.right;
    this.steer = (r ? 1 : 0) - (l ? 1 : 0);
    this.boost = this.isDown('ShiftLeft') || this.isDown('ShiftRight') || t.boost;
    return this.thrust;
  }

  get thrust(): boolean {
    return this.forceThrust ?? (this.isDown('Space') || this.touch.thrust);
  }

  /** A rising edge of the thrust input (keyboard Space, touch, or the debug override). */
  thrustPressed(): boolean {
    const t = this.thrust;
    const edge = t && !this.prevThrust;
    this.prevThrust = t;
    return edge;
  }

  endFrame(): void {
    this.rollPulse = 0;
    this.detachPulse = false;
    this.cameraPulse = false;
    this.pausePulse = false;
    this.mutePulse = false;
    this.restartPulse = false;
    this.startPulse = false;
    this.suctionPulse = false;
    this.langPulse = false;
  }

  /** On-screen buttons for phones and tablets. */
  attachTouch(parent: HTMLElement): void {
    this.autoThrottle = true;
    parent.hidden = false;
    const bind = (id: string, on: () => void, off: () => void) => {
      const b = parent.querySelector<HTMLElement>(`[data-t="${id}"]`);
      if (!b) return;
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); b.classList.add('on'); on(); this.anyKey = true; });
      const end = () => { b.classList.remove('on'); off(); };
      b.addEventListener('pointerup', end);
      b.addEventListener('pointercancel', end);
      b.addEventListener('lostpointercapture', end);
    };
    bind('left', () => (this.touch.left = true), () => (this.touch.left = false));
    bind('right', () => (this.touch.right = true), () => (this.touch.right = false));
    bind('thrust', () => { this.touch.thrust = true; this.detachPulse = true; }, () => (this.touch.thrust = false));
    bind('boost', () => (this.touch.boost = true), () => (this.touch.boost = false));
    bind('brake', () => (this.touch.brake = true), () => (this.touch.brake = false));
    bind('suction', () => (this.suctionPulse = true), () => {});
    bind('rollL', () => (this.rollPulse = -1), () => {});
    bind('rollR', () => (this.rollPulse = 1), () => {});
  }
}
