import type { FieldValues, UseFormSetError, Path } from 'react-hook-form';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { ApiError } from './api-error';
import { refreshMe } from './auth';
import { fieldErrorMessage } from './validation-message';
import { versionConflictStore } from './version-conflict';

export interface ErrorContext<T extends FieldValues = FieldValues> {
  /** Attaches field errors to the form that produced them. */
  setError?: UseFormSetError<T>;
  /** Fields registered by that form; anything else is reported as a toast instead. */
  fields?: readonly string[];
  /** Per-form mapping of an error code onto the field it belongs to. */
  fieldMap?: Partial<Record<string, string>>;
  /** Called for PASSWORD_CHANGE_REQUIRED, so the page can send the user where they must go. */
  onPasswordChangeRequired?: () => void;
  /** Refetches the record a form was editing, offered to the user on a version conflict. */
  onReload?: () => void;
}

/**
 * Turns an `ApiError` into what the user sees, in the order of §7.7.4: field errors first, then a
 * per-form mapping, then the special cases, then a toast. Nothing is ever swallowed silently.
 */
export function handleApiError<T extends FieldValues>(error: unknown, context: ErrorContext<T> = {}): void {
  if (!(error instanceof ApiError)) {
    toast.error(i18n.t('errors.UNKNOWN_ERROR'));
    return;
  }

  if (error.code === 'VALIDATION_FAILED' && error.fields?.length) {
    const unattached = error.fields.filter((field) => {
      const known = context.setError && context.fields?.includes(field.path);
      if (known) {
        context.setError?.(field.path as Path<T>, { type: field.code, message: fieldErrorMessage(field) });
      }
      return !known;
    });
    if (unattached.length === 0) return;
    toast.error(i18n.t(`validation.${unattached[0]?.code ?? 'invalid_type'}`));
    return;
  }

  const mapped = context.fieldMap?.[error.code];
  if (mapped && context.setError) {
    context.setError(mapped as Path<T>, { type: error.code, message: `errors.${error.code}` });
    return;
  }

  if (error.code === 'VERSION_CONFLICT' && context.onReload) {
    versionConflictStore.open({ onReload: context.onReload });
    return;
  }

  if (error.code === 'PASSWORD_CHANGE_REQUIRED' && context.onPasswordChangeRequired) {
    context.onPasswordChangeRequired();
    return;
  }

  if (error.code === 'PERMISSION_DENIED' || error.code === 'ADMIN_ONLY') {
    // The permission set may have changed under the user; take the API's word for it (§7.6).
    void refreshMe().catch(() => undefined);
  }

  toast.error(i18n.t(`errors.${error.code}`, { ...error.details }));
}
