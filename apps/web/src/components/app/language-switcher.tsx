import { LANGUAGES, type Language } from '@pallet/shared';
import { Button } from '@/components/ui/button';
import i18n from '@/i18n';
import { LANGUAGE_NATIVE_NAMES, setPreferences, usePreferences } from '@/lib/preferences';

/**
 * The three languages by their own names, never translated (§7.10). `compact` is the corner of
 * the login card; the full size sits on the account page.
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { language: current } = usePreferences();

  return (
    <div className="flex flex-wrap gap-1">
      {LANGUAGES.map((language: Language) => (
        <Button
          key={language}
          type="button"
          size={compact ? 'sm' : 'default'}
          variant={current === language ? (compact ? 'secondary' : 'default') : compact ? 'ghost' : 'outline'}
          lang={language}
          aria-pressed={current === language}
          onClick={() => {
            setPreferences({ language });
            void i18n.changeLanguage(language);
          }}
        >
          {LANGUAGE_NATIVE_NAMES[language]}
        </Button>
      ))}
    </div>
  );
}
