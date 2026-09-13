import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from './index';
import { dynamicKey } from './keys';

afterEach(() => vi.restoreAllMocks());

describe('i18n setup (§7.10)', () => {
  it('knows only the three languages and never falls back to another', () => {
    expect(i18n.options.supportedLngs).toEqual(['ckb', 'ar', 'en', 'cimode']);
    expect(i18n.options.fallbackLng).toBe(false);
    expect(i18n.options.returnEmptyString).toBe(false);
    expect(i18n.options.react?.useSuspense).toBe(false);
  });

  it('reports a missing key in development instead of passing it silently', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await i18n.changeLanguage('ar');
    i18n.t(dynamicKey('orders.list.doesNotExist'));
    expect(error).toHaveBeenCalledWith('[i18n] missing', 'ar', 'orders.list.doesNotExist');
  });
});
