// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadOnceForNewVersion } from './chunk-reload';

afterEach(() => {
  sessionStorage.clear();
});

describe('chunk reload after a deploy (Q81)', () => {
  it('recognises the failures browsers report for a missing chunk', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(
      true,
    );
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true);
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false);
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false);
  });

  it('reloads once, and not again moments later, so a chunk that stays missing cannot loop', () => {
    const reload = vi.fn();
    expect(reloadOnceForNewVersion(1_000_000, reload)).toBe(true);
    expect(reloadOnceForNewVersion(1_010_000, reload)).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    // A later deploy, well after the first reload, may reload again.
    expect(reloadOnceForNewVersion(1_100_000, reload)).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
