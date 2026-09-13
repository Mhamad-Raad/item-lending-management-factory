import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import type { TranslationKey } from './keys';

describe('typed translation keys (§7.10)', () => {
  it('accept the keys of en.json and refuse any other at compile time', () => {
    const known: TranslationKey = 'orders.list.title';
    // @ts-expect-error — a misspelt key is a type error, not a blank label at runtime.
    const misspelt: TranslationKey = 'orders.list.titel';
    // @ts-expect-error — the same holds where t() is called.
    const called = () => i18n.t('orders.list.titel');
    expect([known, misspelt, typeof called]).toEqual(['orders.list.title', 'orders.list.titel', 'function']);
  });
});
