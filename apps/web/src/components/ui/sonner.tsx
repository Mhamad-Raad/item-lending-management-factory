import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Toaster as Sonner } from 'sonner';
import { usePreferences, useResolvedTheme } from '@/lib/preferences';

/**
 * Sonner's rich colours drawn from the §7.12 tokens: its own palette misses AA (4.3 : 1 for success in
 * light). The tint is 12 % in both themes: the dark badges' 20 % leaves error text at 4.3 : 1 on a popover.
 */
const RICH_COLOURS = Object.fromEntries([
  ['--normal-bg', 'var(--popover)'],
  ['--normal-border', 'var(--border)'],
  ['--normal-text', 'var(--popover-foreground)'],
  ...Object.entries({ success: 'success', info: 'info', warning: 'warning', error: 'destructive' }).flatMap(
    ([kind, token]) => [
      [`--${kind}-bg`, `color-mix(in oklch, var(--${token}) 12%, var(--popover))`],
      [`--${kind}-border`, `color-mix(in oklch, var(--${token}) 30%, var(--popover))`],
      [`--${kind}-text`, `var(--${token})`],
    ],
  ),
]) as CSSProperties;

/** Top-centre in both directions, so the toast never covers the primary action (§7.11). */
export function Toaster() {
  const { t } = useTranslation();
  const { language } = usePreferences();
  const theme = useResolvedTheme();

  return (
    <Sonner
      position="top-center"
      dir={language === 'en' ? 'ltr' : 'rtl'}
      theme={theme}
      richColors
      closeButton
      // Sonner's own label is English with a Latin shortcut name appended.
      customAriaLabel={t('common.notifications')}
      style={RICH_COLOURS}
      className="toaster group"
      toastOptions={{ closeButtonAriaLabel: t('common.actions.close'), classNames: { toast: 'group toast shadow-lg' } }}
    />
  );
}
