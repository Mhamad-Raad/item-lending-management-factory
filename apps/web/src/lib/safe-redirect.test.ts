import { describe, expect, it } from 'vitest';
import { safeRedirect } from './safe-redirect';

const ORIGIN = 'https://pallets.example';

describe('safeRedirect', () => {
  it('follows a path on this site, with its search and hash', () => {
    expect(safeRedirect('/orders/42?tab=returns#top', ORIGIN)).toBe('/orders/42?tab=returns#top');
    expect(safeRedirect('/customers', ORIGIN)).toBe('/customers');
  });

  it('sends anything else home', () => {
    for (const target of [
      undefined,
      '',
      'https://evil.example/',
      'orders',
      '//evil.example',
      '/\\evil.example',
      '/\\/evil.example',
      '\\\\evil.example',
      '/%0a/evil.example'.replace('%0a', '\n'),
      '/\t/evil.example',
      'javascript:alert(1)',
    ]) {
      expect(safeRedirect(target, ORIGIN), JSON.stringify(target)).toBe('/');
    }
  });
});
