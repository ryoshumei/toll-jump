// Procedural WebAudio, started on the first user gesture: motor whine (pitch follows speed), thruster roar
// (filtered noise, volume follows thrust), wind, suction-fan turbine, crash thump, ETC chime.
export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private motorGain!: GainNode;
  private motorFilter!: BiquadFilterNode;
  private o1!: OscillatorNode;
  private o2!: OscillatorNode;
  private whine!: OscillatorNode;
  private whineGain!: GainNode;
  private roarGain!: GainNode;
  private roarFilter!: BiquadFilterNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private fanGain!: GainNode;
  private fan!: OscillatorNode;
  private noise!: AudioBuffer;
  muted = false;
  private last = 0;

  /** iOS Safari only starts or resumes audio inside a gesture handler (not from the frame loop), and it can
   *  suspend the context after a call or an app switch, so every gesture checks it for the life of the page. */
  unlockOnGesture(): void {
    const unlock = () => { if (!this.ctx || this.ctx.state !== 'running') this.start(); };
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
      window.addEventListener(type, unlock, { capture: true, passive: true });
    }
  }

  /** Create the graph (must be called from a user gesture). */
  start(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    // play through the iPhone's silent switch (Safari 17+); without this, WebAudio is muted in silent mode
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    this.master.connect(ctx.destination);

    // one second of noise, looped
    const len = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const loop = () => { const s = ctx.createBufferSource(); s.buffer = this.noise; s.loop = true; s.start(); return s; };

    // motor: two detuned oscillators through a low-pass, plus an electric whine
    this.motorFilter = ctx.createBiquadFilter();
    this.motorFilter.type = 'lowpass';
    this.motorFilter.frequency.value = 800;
    this.motorGain = ctx.createGain();
    this.motorGain.gain.value = 0.0;
    this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ctx.createOscillator(); this.o2.type = 'triangle';
    const g1 = ctx.createGain(); g1.gain.value = 0.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.7;
    this.o1.connect(g1).connect(this.motorFilter);
    this.o2.connect(g2).connect(this.motorFilter);
    this.motorFilter.connect(this.motorGain).connect(this.master);
    this.whine = ctx.createOscillator(); this.whine.type = 'sine';
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain).connect(this.master);
    this.o1.start(); this.o2.start(); this.whine.start();

    // thruster roar
    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'bandpass';
    this.roarFilter.frequency.value = 500;
    this.roarFilter.Q.value = 0.6;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    loop().connect(this.roarFilter).connect(this.roarGain).connect(this.master);

    // wind
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 600;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    loop().connect(this.windFilter).connect(this.windGain).connect(this.master);

    // suction fan turbine
    this.fan = ctx.createOscillator(); this.fan.type = 'sawtooth';
    const fanF = ctx.createBiquadFilter(); fanF.type = 'bandpass'; fanF.frequency.value = 1400; fanF.Q.value = 3;
    this.fanGain = ctx.createGain(); this.fanGain.gain.value = 0;
    this.fan.connect(fanF).connect(this.fanGain).connect(this.master);
    this.fan.start();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.03);
  }

  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Called every frame; it throttles itself to ~30 Hz. speed01/thrust/boost/suction all 0..1. */
  update(now: number, speed01: number, thrust: number, boost: number, suction: number, climb01: number): void {
    const ctx = this.ctx;
    if (!ctx || now - this.last < 0.033) return;
    this.last = now;
    const t = ctx.currentTime;
    const f = 52 + speed01 * 470 + boost * 60;
    this.o1.frequency.setTargetAtTime(f, t, 0.05);
    this.o2.frequency.setTargetAtTime(f * 1.5, t, 0.05);
    this.motorFilter.frequency.setTargetAtTime(500 + speed01 * 2200, t, 0.08);
    this.motorGain.gain.setTargetAtTime(0.05 + speed01 * 0.07, t, 0.08);
    this.whine.frequency.setTargetAtTime(900 + speed01 * 2600, t, 0.05);
    this.whineGain.gain.setTargetAtTime(0.004 + speed01 * 0.012, t, 0.08);
    const roar = Math.max(thrust, boost * 0.8);
    this.roarGain.gain.setTargetAtTime(Math.pow(roar, 1.3) * 0.55, t, 0.06);
    this.roarFilter.frequency.setTargetAtTime(300 + roar * 700, t, 0.08);
    this.windGain.gain.setTargetAtTime(speed01 * speed01 * 0.24, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(400 + speed01 * 2600, t, 0.1);
    this.fanGain.gain.setTargetAtTime(suction * 0.09, t, 0.08);
    this.fan.frequency.setTargetAtTime(520 + climb01 * 420, t, 0.06);
  }

  private burst(dur: number, f0: number, f1: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(f0, ctx.currentTime);
    f.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    s.connect(f).connect(g).connect(this.master);
    s.start();
    s.stop(ctx.currentTime + dur + 0.05);
  }

  private thump(f0: number, f1: number, dur: number, gain: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(f1, ctx.currentTime + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g).connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  crash(): void { this.burst(0.55, 2400, 140, 0.9); this.thump(95, 30, 0.7, 0.9); }
  land(strength: number): void { this.burst(0.35, 900, 120, 0.25 + 0.4 * strength); this.thump(70, 34, 0.4, 0.35 + 0.4 * strength); }
  scrape(): void { this.burst(0.18, 3500, 900, 0.18); }
  boom(): void { this.burst(0.3, 3000, 300, 0.5); this.thump(160, 60, 0.25, 0.4); }

  /** The ETC "嘀": one short, bright beep. */
  chime(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = 2637;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.32, t + 0.006);
    g.gain.setValueAtTime(0.32, t + 0.09);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
  }

  blip(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = 880;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }
}
