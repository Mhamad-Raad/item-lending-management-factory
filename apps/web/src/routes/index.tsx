import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CircleCheck, CircleX, Loader, Moon, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { FONT_SIZES, LANGUAGES, type Language } from '@pallet/shared';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';
import { LANGUAGE_NATIVE_NAMES, setPreferences, usePreferences } from '@/lib/preferences';

export const Route = createFileRoute('/')({
  component: HomePage,
});

async function fetchHealth(): Promise<{ status: string; version: string }> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`health ${res.status}`);
  return res.json() as Promise<{ status: string; version: string }>;
}

function HomePage() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });

  const changeLanguage = (language: Language) => {
    setPreferences({ language });
    void i18n.changeLanguage(language);
  };

  return (
    <motion.main
      className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-4 py-10"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
    >
      <header className="flex flex-col gap-2">
        <p className="text-sm font-medium text-primary">{t('common.appName')}</p>
        <h1 className="text-3xl font-semibold">{t('home.title')}</h1>
        <p className="text-muted-foreground">{t('home.baselineNotice')}</p>
      </header>

      <section className="flex items-center gap-2 rounded-lg border bg-card p-4 text-sm" aria-live="polite">
        {health.isPending ? (
          <>
            <Loader className="size-4 animate-spin" aria-hidden /> {t('status.checking')}
          </>
        ) : health.isSuccess ? (
          <>
            <CircleCheck className="size-4 text-success" aria-hidden /> {t('status.serverOnline')}
            <span className="ms-auto text-muted-foreground" dir="ltr">
              v{health.data.version}
            </span>
          </>
        ) : (
          <>
            <CircleX className="size-4 text-destructive" aria-hidden /> {t('status.serverOffline')}
          </>
        )}
      </section>

      <section className="flex flex-col gap-5 rounded-lg border bg-card p-4">
        <h2 className="text-lg font-semibold">{t('account.preferences.title')}</h2>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('account.preferences.language')}</legend>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((language) => (
              <Button
                key={language}
                variant={prefs.language === language ? 'default' : 'outline'}
                aria-pressed={prefs.language === language}
                lang={language}
                onClick={() => changeLanguage(language)}
              >
                {LANGUAGE_NATIVE_NAMES[language]}
              </Button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('account.preferences.theme')}</legend>
          <div className="flex flex-wrap gap-2">
            <Button
              variant={prefs.theme === 'light' ? 'default' : 'outline'}
              aria-pressed={prefs.theme === 'light'}
              onClick={() => setPreferences({ theme: 'light' })}
            >
              <Sun aria-hidden /> {t('account.preferences.themes.light')}
            </Button>
            <Button
              variant={prefs.theme === 'dark' ? 'default' : 'outline'}
              aria-pressed={prefs.theme === 'dark'}
              onClick={() => setPreferences({ theme: 'dark' })}
            >
              <Moon aria-hidden /> {t('account.preferences.themes.dark')}
            </Button>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t('account.preferences.fontSize')}</legend>
          <div className="flex flex-wrap gap-2">
            {FONT_SIZES.map((size) => (
              <Button
                key={size}
                variant={prefs.fontSize === size ? 'default' : 'outline'}
                aria-pressed={prefs.fontSize === size}
                onClick={() => setPreferences({ fontSize: size })}
              >
                {t(`account.preferences.fontSizes.${size}`)}
              </Button>
            ))}
          </div>
        </fieldset>
      </section>
    </motion.main>
  );
}
