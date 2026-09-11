import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

/** `document.title = <page> — <app name>`, per §7.2. */
export function usePageTitle(titleKey: string): void {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.title = `${t(titleKey)} — ${t('common.appName')}`;
  }, [t, titleKey, i18n.language]);
}
