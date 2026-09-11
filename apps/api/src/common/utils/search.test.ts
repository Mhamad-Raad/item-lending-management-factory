import { describe, expect, it } from 'vitest';
import { escapeLikePattern } from './search';

describe('escapeLikePattern', () => {
  it('escapes the wildcards a user can type', () => {
    expect(escapeLikePattern('100%')).toBe('100\\%');
    expect(escapeLikePattern('a_min')).toBe('a\\_min');
    expect(escapeLikePattern('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves ordinary text alone', () => {
    expect(escapeLikePattern('warehouse one')).toBe('warehouse one');
    expect(escapeLikePattern('ئەنوەر')).toBe('ئەنوەر');
  });
});
