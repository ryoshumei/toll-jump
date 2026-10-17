import { describe, expect, it } from 'vitest';
import { detectLang, dict, SIGNS, t } from './i18n';

describe('i18n', () => {
  it('has every key in both languages, and no empty strings', () => {
    const zh = Object.keys(dict.zh).sort();
    const en = Object.keys(dict.en).sort();
    expect(en).toEqual(zh);
    for (const l of ['zh', 'en'] as const) {
      for (const [k, v] of Object.entries(dict[l])) expect(typeof v === 'string' && v.length > 0, `${l}.${k}`).toBe(true);
    }
  });

  it('every placeholder used in one language is used in the other', () => {
    const ph = (s: string) => (s.match(/\{\d\}/g) ?? []).sort().join('');
    for (const k of Object.keys(dict.zh) as (keyof typeof dict.zh)[]) expect(ph(dict.en[k]), k).toBe(ph(dict.zh[k]));
  });

  it('fills placeholders', () => {
    expect(t('popup.flyover', 45)).toContain('45');
    expect(t('popup.ram', 200)).toContain('200');
  });

  it('picks the default from the browser language', () => {
    expect(detectLang('zh-CN')).toBe('zh');
    expect(detectLang('zh-TW')).toBe('zh');
    expect(detectLang('en-US')).toBe('en');
    expect(detectLang('ja-JP')).toBe('en');
    expect(detectLang(undefined)).toBe('en');
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
