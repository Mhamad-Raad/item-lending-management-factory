import { useSyncExternalStore } from 'react';

/** Tailwind's `md` breakpoint (§7.15), for layouts that render different trees rather than restyle one. */
export const MD_QUERY = '(min-width: 768px)';

/** Whether `query` matches now, following the viewport as it changes. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
  );
}
