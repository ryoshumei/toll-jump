// HUD (DOM over the canvas). Updated at no more than 30 Hz, and a DOM write only happens when a shown value changes.
// The suction state always sits next to the G-FORCE gauge (with a downforce readout in kN while it is on).
import { money, t } from './i18n';

export interface HudState {
  score: number;
  lives: number;
  saved: number;
  kmh: number;
  gas01: number;
  gForce: number;
  altFt: number;
  pitch: number; // rad
  roll: number; // rad
  yaw: number; // rad
  sucOn: boolean;
  downforceKN: number;
  warn: boolean; // on the wall with suction off and about to fall
}

const ARC = 289.03;
const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

export class Hud {
  private root = $('hud');
  private score = $('h-score');
  private lives = $('h-lives');
  private saved = $('h-saved');
  private speed = $('h-speed');
  private gas = $('h-gas');
  private gasPct = $('h-gas-pct');
  private gasBox = $('gas');
  private g = $('h-g');
  private gArc = document.getElementById('g-arc') as unknown as SVGElement;
  private alt = $('h-alt');
  private aArc = document.getElementById('a-arc') as unknown as SVGElement;
  private icSide = document.getElementById('ic-side-g') as unknown as SVGElement;
  private icTop = document.getElementById('ic-top-g') as unknown as SVGElement;
  private suc = $('suc');
  private sucT = $('suc-t');
  private sucKn = $('suc-kn');
  private warn = $('sucwarn');
  private flashEl = $('flash');
  private camtag = $('camtag');
  private muteEl = $('mute');
  private pops = Array.from(document.querySelectorAll<HTMLElement>('#popups .pop'));
  private popIdx = 0;
  private acc = 0;
  private camTimer = 0;
  private l = { score: -1, lives: -1, saved: -1, kmh: -1, gas: -1, g: -1, alt: -1, gArc: -1, aArc: -1, side: -999, top: -999, sucOn: null as boolean | null, kn: -1, warn: false };

  constructor() {
    this.applyLang();
  }

  /** Re-apply every label (the language changed). */
  applyLang(): void {
    $('l-score').textContent = t('hud.score');
    $('l-lives').textContent = t('hud.lives');
    $('l-saved').textContent = t('hud.saved');
    this.warn.textContent = t('hud.sucWarn');
    this.l.sucOn = null; // force the suction pill to redraw
    this.l.score = -1;
    this.l.saved = -1;
  }

  show(b: boolean): void {
    this.root.classList.toggle('hidden', !b);
  }

  update(dt: number, s: HudState): void {
    this.acc += dt;
    if (this.camTimer > 0) {
      this.camTimer -= dt;
      if (this.camTimer <= 0) this.camtag.classList.remove('on');
    }
    if (this.acc < 1 / 30) return;
    this.acc = 0;
    const l = this.l;
    const score = Math.floor(s.score);
    if (score !== l.score) { l.score = score; this.score.textContent = score.toLocaleString('en-US'); }
    if (s.lives !== l.lives) {
      l.lives = s.lives;
      this.lives.innerHTML = '●'.repeat(Math.max(0, s.lives)) + '<span class="off">' + '●'.repeat(Math.max(0, 3 - s.lives)) + '</span>';
    }
    if (s.saved !== l.saved) { l.saved = s.saved; this.saved.textContent = money(s.saved); }
    const kmh = Math.round(s.kmh);
    if (kmh !== l.kmh) { l.kmh = kmh; this.speed.textContent = String(kmh); }
    const gas = Math.round(s.gas01 * 100);
    if (gas !== l.gas) {
      l.gas = gas;
      this.gas.style.transform = `scaleX(${(gas / 100).toFixed(2)})`;
      this.gasPct.textContent = gas + '%';
      this.gasBox.classList.toggle('low', gas < 22);
    }
    const g = Math.round(Math.min(9.9, Math.max(0, s.gForce)) * 10);
    if (g !== l.g) { l.g = g; this.g.textContent = (g / 10).toFixed(1); }
    const gArc = Math.round(Math.min(1, s.gForce / 4) * 120);
    if (gArc !== l.gArc) { l.gArc = gArc; this.gArc.style.strokeDashoffset = String(ARC * (1 - gArc / 120)); }
    const altN = Math.round(Math.max(0, s.altFt) * 10);
    if (altN !== l.alt) { l.alt = altN; this.alt.textContent = (altN / 10).toFixed(1); }
    const aArc = Math.round(Math.min(1, s.altFt / 80) * 120);
    if (aArc !== l.aArc) { l.aArc = aArc; this.aArc.style.strokeDashoffset = String(ARC * (1 - aArc / 120)); }
    const side = Math.round(((s.pitch + s.roll * 0.4) * 180) / Math.PI);
    if (side !== l.side) { l.side = side; this.icSide.style.transform = `rotate(${-side}deg)`; }
    const top = Math.round(((s.yaw * 2 + s.roll) * 180) / Math.PI);
    if (top !== l.top) { l.top = top; this.icTop.style.transform = `rotate(${-top}deg)`; }

    // suction: always shown; the downforce readout only while it is on
    if (s.sucOn !== l.sucOn) {
      l.sucOn = s.sucOn;
      this.suc.classList.toggle('on', s.sucOn);
      this.sucT.textContent = s.sucOn ? t('hud.sucOn') : t('hud.sucOff');
      this.sucKn.style.display = s.sucOn ? '' : 'none';
      l.kn = -1;
    }
    if (s.sucOn) {
      const kn = Math.round(s.downforceKN * 10);
      if (kn !== l.kn) { l.kn = kn; this.sucKn.textContent = `${(kn / 10).toFixed(1)} kN`; }
    }
    if (s.warn !== l.warn) { l.warn = s.warn; this.warn.classList.toggle('hidden', !s.warn); }
  }

  popup(text: string, kind: 'good' | 'bad' | 'info' | 'big' = 'good'): void {
    const el = this.pops[this.popIdx];
    this.popIdx = (this.popIdx + 1) % this.pops.length;
    el.className = 'pop ' + kind;
    el.textContent = text;
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('run');
    el.style.top = `${(this.popIdx % 2) * 46}px`;
  }

  flash(): void {
    this.flashEl.classList.remove('run');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('run');
  }

  camera(name: string): void {
    this.camtag.textContent = name;
    this.camtag.classList.add('on');
    this.camTimer = 1.6;
  }

  muted(m: boolean): void {
    this.muteEl.classList.toggle('on', m);
  }

  reset(): void {
    const l = this.l;
    l.score = l.lives = l.saved = l.kmh = l.gas = l.g = l.alt = l.gArc = l.aArc = -1;
    l.side = l.top = -999;
    l.sucOn = null;
    l.kn = -1;
    l.warn = false;
    this.warn.classList.add('hidden');
  }
}
