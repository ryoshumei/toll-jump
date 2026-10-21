import { describe, expect, it } from 'vitest';
import { detectLang, dict, getLang, isLang, LANGS, money, setLang, sign, signPrice, SIGNS, t, toggleLang } from './i18n';

describe('i18n', () => {
  it('has every key in every language, and no empty strings', () => {
    const zh = Object.keys(dict.zh).sort();
    for (const l of LANGS) {
      expect(Object.keys(dict[l]).sort(), l).toEqual(zh);
      for (const [k, v] of Object.entries(dict[l])) expect(typeof v === 'string' && v.length > 0, `${l}.${k}`).toBe(true);
    }
  });

  it('every placeholder used in one language is used in the others', () => {
    const ph = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join('');
    for (const k of Object.keys(dict.zh) as (keyof typeof dict.zh)[]) {
      for (const l of LANGS) expect(ph(dict[l][k]), `${l}.${k}`).toBe(ph(dict.zh[k]));
    }
  });

  it('has touch copy for the start, pause and game-over lines: tap wording that names no keyboard key', () => {
    for (const l of LANGS) {
      for (const k of ['startTouch', 'screen.hintResumeTouch', 'screen.hintRestartTouch'] as const) {
        expect(dict[l][k], `${l}.${k}`).not.toMatch(/Enter|Esc|\bR\b|キー|按键/);
      }
      expect(dict[l].startTouch, l).not.toBe(dict[l].start);
      expect(dict[l]['screen.hintResumeTouch'], l).not.toBe(dict[l]['screen.hintResume']);
      expect(dict[l]['screen.hintRestartTouch'], l).not.toBe(dict[l]['screen.hintRestart']);
    }
  });

  it('the touch lines name the real buttons (their labels), so they promise only taps that do something', () => {
    for (const l of LANGS) {
      const d = dict[l];
      expect(d['screen.hintResumeTouch'], `${l} pause`).toContain(d['screen.resume']);
      expect(d['screen.hintResumeTouch'], `${l} pause`).toContain(d['screen.restart']);
      expect(d['screen.hintRestartTouch'], `${l} game over`).toContain(d['screen.restart']);
    }
  });

  it('fills placeholders', () => {
    expect(t('popup.flyover', 45)).toContain('45');
    expect(t('popup.ram', 200)).toContain('200');
  });

  it('picks the default from the browser language', () => {
    expect(detectLang('zh-CN')).toBe('zh');
    expect(detectLang('zh-TW')).toBe('zh');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('ja-JP')).toBe('ja');
    expect(detectLang('ja')).toBe('ja');
    expect(detectLang('fr-FR')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
  });

  it('L cycles 中文 → English → 日本語 and back', () => {
    const start = getLang();
    const seen = [toggleLang(), toggleLang(), toggleLang()];
    expect(new Set(seen)).toEqual(new Set(LANGS));
    expect(getLang()).toBe(start);
  });

  it('accepts only known language codes (URL parameter, stored choice)', () => {
    for (const l of LANGS) expect(isLang(l)).toBe(true);
    expect(isLang('fr')).toBe(false);
    expect(isLang(null)).toBe(false);
  });

  it('in-world signs carry a Chinese line and an English line', () => {
    const [zh, en] = SIGNS.fascia;
    expect(zh).toBe('火星高速 · 星舰收费站');
    expect(en).toBe('MARS EXPRESSWAY · STARSHIP TOLL STATION');
    expect(SIGNS.price(45)[0]).toContain('¥45');
    expect(SIGNS.price(45)[1]).toContain('¥45');
    expect(SIGNS.exitFar[1]).toMatch(/STUNT ARENA/);
  });

  it('signs read Chinese + English, or Japanese + English when the UI is Japanese', () => {
    const start = getLang();
    for (const l of ['zh', 'en'] as const) {
      setLang(l);
      expect(sign('fascia')).toEqual(SIGNS.fascia);
      expect(signPrice(45)).toEqual(SIGNS.price(45));
    }
    setLang('ja');
    expect(sign('fascia')).toEqual(['火星高速道路 · スターシップ料金所', SIGNS.fascia[1]]);
    expect(sign('arena')).toEqual(['スタントアリーナ', 'STUNT ARENA']);
    expect(signPrice(60)).toEqual(['普通車 1,200円', 'CAR ¥1,200']);
    setLang(start);
  });

  it('shows money in yuan, or in yen at a believable toll level for the Japanese UI', () => {
    const start = getLang();
    setLang('zh');
    expect(money(45)).toBe('¥45');
    expect(t('popup.flyover', money(45))).toBe('飞跃收费站！省下 ¥45');
    setLang('ja');
    expect(money(45)).toBe('900円');
    expect(money(200)).toBe('4,000円');
    expect(t('popup.flyover', money(50))).toBe('料金所を飛び越えた！1,000円浮いた');
    setLang(start);
  });
});
