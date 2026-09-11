import { describe, expect, it } from 'vitest';
import ar from './locales/ar.json';
import ckb from './locales/ckb.json';
import en from './locales/en.json';

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  return Object.entries(tree).reduce<Record<string, string>>((acc, [key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === 'string' ? { ...acc, [path]: value } : { ...acc, ...flatten(value, path) };
  }, {});
}

const files = { ckb: flatten(ckb), ar: flatten(ar), en: flatten(en) };

/** Keys whose ckb/ar values may legitimately contain Latin letters. */
const LATIN_ALLOWED_KEYS = new Set<string>([]);

describe('translation files', () => {
  it('have identical key sets in ckb, ar and en', () => {
    const enKeys = Object.keys(files.en).sort();
    expect(Object.keys(files.ckb).sort()).toEqual(enKeys);
    expect(Object.keys(files.ar).sort()).toEqual(enKeys);
  });

  it('have no empty values', () => {
    for (const [lang, entries] of Object.entries(files)) {
      for (const [key, value] of Object.entries(entries)) expect(value.trim(), `${lang}:${key}`).not.toBe('');
    }
  });

  it('contain no English fallbacks in the Kurdish and Arabic files', () => {
    for (const lang of ['ckb', 'ar'] as const) {
      for (const [key, value] of Object.entries(files[lang])) {
        if (LATIN_ALLOWED_KEYS.has(key)) continue;
        expect(/[A-Za-z]/.test(value), `${lang}:${key} = "${value}"`).toBe(false);
      }
    }
  });
});
