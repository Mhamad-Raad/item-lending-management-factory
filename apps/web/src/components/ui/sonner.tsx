import { Toaster as Sonner } from 'sonner';
import { usePreferences } from '@/lib/preferences';

/** Top-centre in both directions, so the toast never covers the primary action (§7.11). */
export function Toaster() {
  const { language, theme } = usePreferences();

  return (
    <Sonner
      position="top-center"
      dir={language === 'en' ? 'ltr' : 'rtl'}
      theme={theme}
      className="toaster group"
      toastOptions={{ classNames: { toast: 'group toast border-border bg-background text-foreground shadow-lg' } }}
    />
  );
}
