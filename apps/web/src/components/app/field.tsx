import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { decodeValidationMessage } from '@/lib/validation-message';

/** One labelled control with its description and error, wired up for screen readers (§7.9). */
export function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="field" className={cn('flex flex-col gap-2', className)} {...props} />;
}

export function FieldLabel(props: React.ComponentProps<typeof Label>) {
  return <Label {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p className={cn('text-muted-foreground text-sm', className)} {...props} />;
}

/**
 * Renders a react-hook-form message. Messages are i18n keys, not prose (§7.9), and the params of
 * the issue ride along inside the message so `too_short` can say how short.
 */
export function FieldError({ id, message }: { id: string; message?: string }) {
  const { t } = useTranslation();
  if (!message) return null;

  const { key, params } = decodeValidationMessage(message);
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {t(key, { ...params, defaultValue: t('errors.UNKNOWN_ERROR') })}
    </p>
  );
}
