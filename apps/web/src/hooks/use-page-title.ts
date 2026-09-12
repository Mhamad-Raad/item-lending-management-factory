import { useEffect, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

let currentKey: string | null = null;
const listeners = new Set<() => void>();

function publish(key: string | null): void {
  currentKey = key;
  for (const listener of listeners) listener();
}

/**
 * `document.title = <page> — <app name>`, per §7.2. The key is also published for the shell, whose
 * top bar shows the page title below `lg` (§7.5), so a page names itself in one place.
 */
export function usePageTitle(titleKey: string): void {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = `${t(titleKey)} — ${t('common.appName')}`;
  }, [t, titleKey, i18n.language]);

  useEffect(() => {
    publish(titleKey);
    return () => {
      if (currentKey === titleKey) publish(null);
    };
  }, [titleKey]);
}

/** The i18n key of the title the mounted page declared, or null while none has. */
export function useCurrentPageTitleKey(): string | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => currentKey,
  );
}
