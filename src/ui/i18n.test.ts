import { describe, expect, it } from 'vitest';
import { detectLang, dict, getLang, isLang, LANGS, SIGNS, t, toggleLang } from './i18n';

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
});
