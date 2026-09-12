/**
 * Stable machine-readable API error codes and their HTTP status.
 * The API never returns user-facing prose; the web app maps each code to the i18n key
 * `errors.<CODE>` in all three languages.
 */
export const ERROR_CODES = {
  // Generic
  VALIDATION_FAILED: 400,
  CSRF_HEADER_MISSING: 403,
  NOT_FOUND: 404,
  ROUTE_NOT_FOUND: 404,
  VERSION_CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  BUSINESS_DATE_IN_FUTURE: 400,
  DATE_RANGE_INVALID: 400,

  // Authentication and sessions
  AUTH_REQUIRED: 401,
  AUTH_TOKEN_EXPIRED: 401,
  AUTH_TOKEN_INVALID: 401,
  AUTH_INVALID_CREDENTIALS: 401,
  AUTH_REFRESH_INVALID: 401,
  PASSWORD_CHANGE_REQUIRED: 403,
  CURRENT_PASSWORD_INCORRECT: 400,
  PASSWORD_TOO_SHORT: 400,
  PASSWORD_TOO_LONG: 400,
  PASSWORD_TOO_COMMON: 400,
  PASSWORD_SAME_AS_CURRENT: 400,

  // Authorization
  PERMISSION_DENIED: 403,
  ADMIN_ONLY: 403,

  // Users and permissions
  USER_NOT_FOUND: 404,
  USERNAME_TAKEN: 409,
  SELF_DEACTIVATE_FORBIDDEN: 409,
  SELF_DEMOTE_FORBIDDEN: 409,
  LAST_ADMIN_GUARD: 409,
  PERMISSION_KEY_UNKNOWN: 400,
  PERMISSION_NOT_GRANTABLE: 400,
  PERMISSION_DEPENDENCY_MISSING: 400,
  PERMISSIONS_ADMIN_IMPLICIT: 409,

  // Uploads
  UPLOAD_MISSING_FILE: 400,
  UPLOAD_TYPE_NOT_ALLOWED: 415,
  UPLOAD_TOO_LARGE: 413,
  UPLOAD_INVALID_IMAGE: 400,
  UPLOAD_NOT_FOUND: 404,
  UPLOAD_KIND_MISMATCH: 400,

  // Items, batches, stock
  ITEM_NOT_FOUND: 404,
  ITEM_ARCHIVED: 409,
  ITEM_ALREADY_ARCHIVED: 409,
  STOCK_INSUFFICIENT: 409,
  BATCH_NOT_FOUND: 404,

  // Customers and drivers
  CUSTOMER_NOT_FOUND: 404,
  CUSTOMER_ARCHIVED: 409,
  CUSTOMER_ALREADY_ARCHIVED: 409,
  CUSTOMER_PHONE_DUPLICATE: 409,
  CUSTOMER_HAS_OPEN_ORDERS: 409,
  DRIVER_NOT_FOUND: 404,
  DRIVER_ARCHIVED: 409,
  DRIVER_ALREADY_ARCHIVED: 409,

  // Orders
  ORDER_NOT_FOUND: 404,
  ORDER_CANCELLED: 409,
  ORDER_HAS_ACTIVITY: 409,
  ORDER_DATE_AFTER_ACTIVITY: 409,
  CREDIT_LIMIT_EXCEEDED: 409,
  UNIT_DEPOSIT_NOT_PERMITTED: 403,

  // Returns
  RETURN_NOT_FOUND: 404,
  RETURN_EMPTY: 400,
  RETURN_LINE_NOT_IN_ORDER: 400,
  RETURN_DUPLICATE_LINE: 400,
  RETURN_EXCEEDS_OUT: 409,
  DAMAGED_REFUND_TOO_HIGH: 400,
  RETURN_ALREADY_REVERSED: 409,
  RETURN_DATE_BEFORE_ORDER_DATE: 400,

  // Payments and ledger
  PAYMENT_ORDER_NOT_LENT: 409,
  PAYMENT_EXCEEDS_OWED: 409,
  PAYMENT_DATE_BEFORE_ORDER_DATE: 400,
  LEDGER_ENTRY_NOT_FOUND: 404,
  LEDGER_ENTRY_NOT_REVERSIBLE: 409,
  LEDGER_ENTRY_ALREADY_REVERSED: 409,

  // Idempotency
  IDEMPOTENCY_KEY_REQUIRED: 400,
  IDEMPOTENCY_KEY_INVALID: 400,
  IDEMPOTENCY_KEY_REUSED: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const ERROR_CODE_LIST = Object.keys(ERROR_CODES) as ErrorCode[];

/** Shape of every non-2xx JSON response body. */
export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    /** Machine-readable context (numbers, ids). Never prose. */
    details?: Record<string, unknown>;
    /** Present only for VALIDATION_FAILED. */
    fields?: ApiFieldError[];
  };
  requestId: string;
}

export interface ApiFieldError {
  /** Dot path into the request body, e.g. `lines.0.quantity`. */
  path: string;
  /** Validation code, mapped to i18n key `validation.<code>`. */
  code: ValidationCode;
  params?: Record<string, string | number>;
}

export const VALIDATION_CODES = [
  'required',
  'invalid_type',
  'too_small',
  'too_big',
  'too_short',
  'too_long',
  'invalid_format',
  'invalid_date',
  'invalid_enum',
  'not_integer',
  'unknown_key',
  'duplicate',
] as const;

export type ValidationCode = (typeof VALIDATION_CODES)[number];
