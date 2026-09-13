import { formatMoney, formatNumber, formatOrderNumber } from '@pallet/shared';
import type { TFunction } from 'i18next';
import { isolate } from './bidi';
import { dynamicKey } from '@/i18n/keys';

/**
 * Audit summaries interpolate raw values: the API stores enums untranslated and numbers unformatted
 * by design — prose never crosses the wire — so the sentence is only readable once they are turned
 * into what the rest of the UI shows.
 */
const ENUM_PARAMS: Record<string, (value: string) => string> = {
  role: (value) => `enums.role.${value}`,
  reason: (value) => `auth.loginFailure.${value}`,
  kind: (value) => `enums.uploadKind.${value}`,
  paymentType: (value) => `enums.paymentType.${value}`,
};

/** Numbers are never formatted by i18next (§7.10): Western digits and separators, as everywhere else. */
const NUMBER_PARAMS: Record<string, (value: number) => string> = {
  // Order numbers are shown six digits wide wherever they appear (A6).
  orderNumber: formatOrderNumber,
  depositTotal: formatMoney,
  depositPrice: formatMoney,
  amount: formatMoney,
  excess: formatMoney,
  refundDue: formatMoney,
  cashRefund: formatMoney,
  quantity: formatNumber,
  initialQuantity: formatNumber,
  accepted: formatNumber,
  damaged: formatNumber,
};

export function translateSummaryParams(t: TFunction, params: Record<string, unknown>): Record<string, unknown> {
  const translated: Record<string, unknown> = { ...params };
  // Names and other typed text keep their own direction inside the sentence.
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && !(key in ENUM_PARAMS)) translated[key] = isolate(value);
  }
  for (const [key, toKey] of Object.entries(ENUM_PARAMS)) {
    const value = params[key];
    if (typeof value === 'string') translated[key] = t(dynamicKey(toKey(value)));
  }
  for (const [key, format] of Object.entries(NUMBER_PARAMS)) {
    const value = params[key];
    if (typeof value === 'number') translated[key] = format(value);
  }
  return translated;
}
