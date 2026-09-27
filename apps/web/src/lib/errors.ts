import { formatNumber, type ApiFieldError } from '@pallet/shared';
import type { FieldValues, UseFormSetError, Path } from 'react-hook-form';
import { toast } from 'sonner';
import i18n from '@/i18n';
import { dynamicKey, type TranslationKey } from '@/i18n/keys';
import { ApiError } from './api-error';
import { isolate } from './bidi';
import { refreshMe } from './auth';
import { decodeValidationMessage, fieldErrorMessage } from './validation-message';
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
    const [first] = unattached;
    if (!first) return;
    toast.error(unattachedFieldMessage(first));
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

  const message = i18n.t(`errors.${error.code}`, formatDetails(error.details));
  // A failure the user cannot fix gets the request's reference, which is what makes it traceable in the logs.
  if (SERVER_FAILURES.has(error.code) && error.requestId) {
    toast.error(message, { description: i18n.t('common.errorReference', { id: isolate(error.requestId) }) });
  } else {
    toast.error(message);
  }
}

/**
 * The last named segment of an API field path → the label the forms already use for it, so a field
 * error that has no field on screen to sit under still says which value it is about (`Quantity (line 2):
 * Must be at least 1`). A name missing here reads as "A field".
 */
const FIELD_LABELS: Partial<Record<string, TranslationKey>> = {
  customerId: 'orders.fields.customer',
  driverId: 'orders.fields.driver',
  paymentType: 'orders.fields.paymentType',
  date: 'orders.fields.date',
  notes: 'orders.fields.notes',
  note: 'payments.fields.note',
  lines: 'orders.lines.title',
  itemId: 'orders.lines.item',
  quantity: 'orders.lines.quantity',
  unitDeposit: 'orders.lines.unitDeposit',
  acceptedQuantity: 'returns.fields.accepted',
  damagedQuantity: 'returns.fields.damaged',
  damagedRefund: 'returns.fields.damagedRefund',
  amount: 'payments.fields.amount',
  name: 'customers.fields.name',
  phone: 'customers.fields.phone',
  altPhone: 'customers.fields.altPhone',
  address: 'customers.fields.address',
  creditLimit: 'customers.fields.creditLimit',
  carNumber: 'drivers.fields.carNumber',
  depositPrice: 'items.fields.depositPrice',
  minStock: 'items.fields.minStock',
  unitCost: 'purchases.fields.unitCost',
  username: 'users.fields.username',
  displayName: 'users.fields.displayName',
  role: 'users.fields.role',
  factoryName: 'settings.fields.factoryName',
};

/** A field error the form has no field for, as one sentence naming the field (and its line, when in a list). */
function unattachedFieldMessage(field: ApiFieldError): string {
  const segments = field.path.split('.');
  const name = [...segments].reverse().find((segment) => !/^\d+$/.test(segment)) ?? '';
  const index = segments.find((segment) => /^\d+$/.test(segment));
  const labelKey = FIELD_LABELS[name];
  const label = labelKey ? i18n.t(labelKey) : i18n.t('validation.fieldNames.other');
  const named =
    index === undefined ? label : i18n.t('validation.fieldNames.inLine', { field: label, line: Number(index) + 1 });
  const { key, params } = decodeValidationMessage(fieldErrorMessage(field));
  return i18n.t('validation.unattached', {
    field: named,
    message: i18n.t(dynamicKey(key), formatDetails(params)),
  });
}

const SERVER_FAILURES = new Set<string>(['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE', 'UNKNOWN_ERROR']);

/** Numbers in an error's details are written as the app writes numbers (§7.10): Western digits, grouped. */
function formatDetails(details: Record<string, unknown> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details ?? {}).map(([key, value]) => [
      key,
      typeof value === 'number' && Number.isFinite(value) ? formatNumber(value) : value,
    ]),
  );
}
