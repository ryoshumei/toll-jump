// Start, pause and game-over screens (DOM). Buttons call back into the game. All text comes from i18n.
import { getLang, HTML_LANG, LANG_LABEL, LANGS, money, t } from './i18n';

export interface RunStats {
  score: number;
  best: number;
  distance: number;
  tolls: number;
  saved: number;
  fines: number;
  stunts: number;
  newBest: boolean;
}

const $ = <E extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as E;

export class Screens {
  private loading = $('loading');
  private start = $('start');
  private pause = $('pause');
  private over = $('over');

  constructor(cb: { onStart(): void; onResume(): void; onRestart(): void; onLang(): void }) {
    this.applyLang();
    this.start.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).id === 'langbtn') return;
      cb.onStart();
    });
    $('langbtn').addEventListener('click', (e) => { e.stopPropagation(); cb.onLang(); });
    $('p-resume').addEventListener('click', () => cb.onResume());
    $('p-restart').addEventListener('click', () => cb.onRestart());
    $('o-restart').addEventListener('click', () => cb.onRestart());
  }

  /** Re-apply every label (the language changed). */
  applyLang(): void {
    // <html lang> picks the right CJK glyphs and the :lang(ja) font stack in index.html
    document.documentElement.lang = HTML_LANG[getLang()];
    $('langbtn').innerHTML = LANGS.map((l) => `<span${l === getLang() ? ' class="on"' : ''}>${LANG_LABEL[l]}</span>`).join(' · ');
    document.title = getLang() === 'en' ? 'RDSTR Toll Jump' : `${t('title')} · RDSTR Toll Jump`;
    $('loading-text').textContent = t('loading');
    for (const k of ['brake', 'thrust', 'boost'] as const) {
      const b = document.querySelector(`#touch [data-t=${k}]`);
      if (b) b.textContent = t(`touch.${k}`);
    }
    $('s-title').textContent = t('title');
    $('s-sub').textContent = t('subtitle');
    $('s-go').textContent = t('start');
    $('p-title').textContent = t('screen.pauseTitle');
    $('p-resume').textContent = t('screen.resume');
    $('p-restart').textContent = t('screen.restart');
    $('p-hint').textContent = t('screen.hintResume');
    $('o-title').textContent = t('screen.overTitle');
    $('o-restart').textContent = t('screen.restart');
    $('o-hint').textContent = t('screen.hintRestart');
    $('o-new').textContent = t('screen.newBest');
    const ctl = $('controls');
    ctl.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const a = document.createElement('div'); a.className = 'k'; a.textContent = t(`ctl.k${i}` as 'ctl.k0');
      const b = document.createElement('div'); b.className = 'd'; b.textContent = t(`ctl.d${i}` as 'ctl.d0');
      ctl.append(a, b);
    }
  }

  private fill(el: HTMLElement, s: RunStats): void {
    const rows: [string, string][] = [
      [t('screen.score'), Math.floor(s.score).toLocaleString('en-US')],
      [t('screen.best'), Math.floor(s.best).toLocaleString('en-US')],
      [t('screen.distance'), `${(s.distance / 1000).toFixed(2)} km`],
      [t('screen.tolls'), String(s.tolls)],
      [t('screen.saved'), money(s.saved)],
      [t('screen.fines'), money(s.fines)],
      [t('screen.stunts'), String(s.stunts)],
    ];
    el.innerHTML = '';
    for (const [k, v] of rows) {
      const d = document.createElement('div');
      const sp = document.createElement('span'); sp.textContent = k;
      const b = document.createElement('b'); b.textContent = v;
      d.append(sp, b);
      el.append(d);
    }
  }

  hideLoading(): void {
    this.loading.classList.remove('on');
    setTimeout(() => this.loading.classList.add('hidden'), 600);
  }

  showStart(b: boolean): void { this.start.classList.toggle('on', b); }
  showPause(b: boolean, s?: RunStats): void {
    if (b && s) this.fill($('p-stats'), s);
    this.pause.classList.toggle('on', b);
  }
  showOver(b: boolean, s?: RunStats): void {
    if (b && s) {
      this.fill($('o-stats'), s);
      $('o-new').classList.toggle('hidden', !s.newBest);
    }
    this.over.classList.toggle('on', b);
  }
  get anyOpen(): boolean {
    return this.start.classList.contains('on') || this.pause.classList.contains('on') || this.over.classList.contains('on');
  }
}
