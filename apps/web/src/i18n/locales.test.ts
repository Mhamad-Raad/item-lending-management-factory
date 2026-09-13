import {
  AUDIT_ACTIONS,
  AUDIT_SUMMARY_KEYS,
  AUDIT_ENTITY_TYPES,
  ERROR_CODE_LIST,
  LEDGER_ENTRY_SOURCES,
  LEDGER_ENTRY_TYPES,
  ORDER_STATUSES,
  PAYMENT_TYPES,
  PERMISSION_KEYS,
  ROLES,
  STOCK_MOVEMENT_REASONS,
  VALIDATION_CODES,
} from '@pallet/shared';
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

/** Keys whose ckb/ar values may legitimately contain Latin letters (§7.10). */
const LATIN_ALLOWED_KEYS = new Set<string>([]);

const PLACEHOLDER = /\{\{[^}]*\}\}/g;

/** The client-only codes of §7.7.1, which the server never sends but the UI must still name. */
const CLIENT_ERROR_CODES = ['NETWORK_ERROR', 'UNKNOWN_ERROR'];

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

  it('name every error code, validation code, enum value and permission key', () => {
    const required = [
      ...[...ERROR_CODE_LIST, ...CLIENT_ERROR_CODES].map((code) => `errors.${code}`),
      ...VALIDATION_CODES.map((code) => `validation.${code}`),
      ...ROLES.map((role) => `enums.role.${role}`),
      ...AUDIT_ACTIONS.map((action) => `enums.auditAction.${action}`),
      ...AUDIT_ENTITY_TYPES.map((entity) => `enums.auditEntityType.${entity}`),
      ...STOCK_MOVEMENT_REASONS.map((reason) => `enums.stockMovementReason.${reason}`),
      ...PAYMENT_TYPES.map((type) => `enums.paymentType.${type}`),
      ...ORDER_STATUSES.map((status) => `enums.orderStatus.${status}`),
      ...LEDGER_ENTRY_TYPES.map((type) => `enums.ledgerEntryType.${type}`),
      ...LEDGER_ENTRY_SOURCES.map((source) => `enums.ledgerEntrySource.${source}`),
      ...PERMISSION_KEYS.map((key) => `permissions.${key.replace(/\./g, '_')}`),
      // §11.1: every audit row the API can write reads as a sentence.
      ...AUDIT_SUMMARY_KEYS,
    ];

    expect(required.filter((key) => !(key in files.en))).toEqual([]);
  });

  it('contain no English fallbacks in the Kurdish and Arabic files', () => {
    for (const lang of ['ckb', 'ar'] as const) {
      for (const [key, value] of Object.entries(files[lang])) {
        if (LATIN_ALLOWED_KEYS.has(key)) continue;
        // Placeholders keep their Latin names in every language.
        expect(/[A-Za-z]/.test(value.replace(PLACEHOLDER, '')), `${lang}:${key} = "${value}"`).toBe(false);
      }
    }
  });

  it('write numbers in Western digits, as the whole UI does (§7.11)', () => {
    for (const lang of ['ckb', 'ar'] as const) {
      for (const [key, value] of Object.entries(files[lang])) {
        expect(/[\u0660-\u0669\u06F0-\u06F9]/.test(value), `${lang}:${key} = "${value}"`).toBe(false);
      }
    }
  });

  it('do not leave a translated value identical to the English one', () => {
    for (const lang of ['ckb', 'ar'] as const) {
      for (const [key, value] of Object.entries(files[lang])) {
        if (value.length < 3) continue;
        expect(value, `${lang}:${key}`).not.toBe(files.en[key]);
      }
    }
  });

  it('use the same placeholders in every language', () => {
    for (const [key, english] of Object.entries(files.en)) {
      const expected = [...english.matchAll(PLACEHOLDER)].map(([match]) => match).sort();
      for (const lang of ['ckb', 'ar'] as const) {
        const actual = [...(files[lang][key] ?? '').matchAll(PLACEHOLDER)].map(([match]) => match).sort();
        expect(actual, `${lang}:${key}`).toEqual(expected);
      }
    }
  });

  it('uses no plural suffixes, which Arabic could not satisfy', () => {
    const forbidden = /_(one|other|zero|two|few|many)$/;
    expect(Object.keys(files.en).filter((key) => forbidden.test(key))).toEqual([]);
  });
});
