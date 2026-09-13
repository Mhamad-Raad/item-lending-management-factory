import {
  ACTIVITY_EVENT_KINDS,
  CUSTOMER_HISTORY_KINDS,
  GRANTABLE_PERMISSION_KEYS,
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
  UPLOAD_KINDS,
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
      ...ACTIVITY_EVENT_KINDS.map((kind) => `enums.activityEventKind.${kind}`),
      ...CUSTOMER_HISTORY_KINDS.map((kind) => `enums.customerHistoryKind.${kind}`),
      // Keys the pages build from data through dynamicKey(): nothing but this test proves they exist.
      ...UPLOAD_KINDS.map((kind) => `enums.uploadKind.${kind}`),
      ...new Set(GRANTABLE_PERMISSION_KEYS.map((key) => `permissions.modules.${key.split('.')[0]}`)),
      // The reasons the API writes into a LOGIN_FAILURE audit row (auth.service.ts).
      ...['INVALID', 'LOCKED', 'INACTIVE'].map((reason) => `auth.loginFailure.${reason}`),
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

  it('word different things differently where they stand side by side', () => {
    // An order's payment type sits beside its owed amount on the same row and card: "on credit" and "owed"
    // must not read as one word (M6 language pass).
    const DISTINCT: [string, string][] = [
      ['enums.paymentType.LENT', 'orders.fields.owed'],
      ['enums.paymentType.LENT', 'customers.fields.owed'],
      ['customers.fields.headroom', 'customers.fields.owed'],
      ['enums.paymentType.CASH', 'enums.paymentType.LENT'],
    ];
    for (const lang of ['ckb', 'ar', 'en'] as const) {
      for (const [a, b] of DISTINCT) {
        expect(files[lang][a], `${lang}: ${a} vs ${b}`).not.toBe(files[lang][b]);
      }
    }
  });

  it('name each concept with one word throughout (the glossary a proofreader checks against)', () => {
    // English wording → the stem every Kurdish and Arabic string for it uses. The receipt keeps the
    // wording of the factory's paper receipt (§7.16), which says تەئمینات for the deposit.
    const GLOSSARY: { en: RegExp; ckb: RegExp; ar: RegExp; except?: RegExp }[] = [
      { en: /\bdamaged\b/i, ckb: /تێکچوو/, ar: /تالف/ },
      { en: /\bcustomers?\b/i, ckb: /کڕیار/, ar: /زبون|زبائن/ },
      { en: /\bdriver/i, ckb: /شۆفێر/, ar: /سائق/ },
      { en: /\bdeposit/i, ckb: /بارمتە/, ar: /تأمين/, except: /^receipt\./ },
      { en: /\bdamage(d)? refund/i, ckb: /گەڕاندنەوەی پارەی تێکچوو/, ar: /استرداد التالف/ },
    ];
    const offences: string[] = [];
    for (const { en: english, ckb: kurdish, ar: arabic, except } of GLOSSARY) {
      for (const [key, value] of Object.entries(files.en)) {
        // Placeholders ({{customerName}}, {{depositTotal}}) are values, not the word for the concept.
        if (!english.test(value.replace(PLACEHOLDER, '')) || except?.test(key)) continue;
        if (!kurdish.test(files.ckb[key] ?? '')) offences.push(`ckb:${key} = "${files.ckb[key]}"`);
        if (!arabic.test(files.ar[key] ?? '')) offences.push(`ar:${key} = "${files.ar[key]}"`);
      }
    }
    expect(offences).toEqual([]);
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
