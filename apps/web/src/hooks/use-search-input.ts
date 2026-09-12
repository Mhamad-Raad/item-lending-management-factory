import { useEffect, useState } from 'react';
import { useDebouncedValue } from './use-debounced-value';

/**
 * A search box bound to a URL search parameter, in both directions: typing reaches the URL after a
 * pause, and the URL changing on its own — a navigation link, Back — reaches the box. With only
 * the first half, a term the URL no longer carries pushes itself back after the debounce, so the
 * filter could never be cleared by navigating.
 */
export function useSearchInput(
  urlValue: string | undefined,
  commit: (value: string | undefined) => void,
): [term: string, setTerm: (value: string) => void] {
  const [term, setTerm] = useState(urlValue ?? '');
  const [seenUrlValue, setSeenUrlValue] = useState(urlValue);

  // Adjusted during render rather than in an effect, so the box never shows a frame of the old term.
  if (urlValue !== seenUrlValue) {
    setSeenUrlValue(urlValue);
    // The URL holds the trimmed term; keep a trailing space the user is still in the middle of typing.
    if ((term.trim() || undefined) !== urlValue) setTerm(urlValue ?? '');
  }

  const debounced = useDebouncedValue(term);

  useEffect(() => {
    // Only once typing has paused: a term the URL has just replaced is still settling here.
    if (debounced !== term) return;
    const next = debounced.trim() || undefined;
    if (next !== urlValue) commit(next);
  }, [debounced, term, urlValue, commit]);

  return [term, setTerm];
}
