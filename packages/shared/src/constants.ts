/** A normalised phone number: an optional `+`, then 7–15 digits (Q13). The database checks the same. */
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** The longest search term a list accepts (§6.2); the web box stops typing at the same length. */
export const SEARCH_MAX_LENGTH = 100;

/** The life of an access token (§6.8). The web renews it a minute before that, however the two clocks differ. */
export const ACCESS_TOKEN_TTL_MINUTES = 15;

/**
 * How long a signed-in user may do nothing before the session ends (Q136). The web counts it from the last key,
 * click, touch or scroll in any tab; the API's own limit between two refreshes is this plus an access token's life.
 */
export const SESSION_IDLE_MINUTES = 15;
/** How long before that the web asks whether the user is still there. */
export const SESSION_IDLE_WARNING_SECONDS = 60;

/** The client's key for one order, return or payment submission (§6.7). */
export const IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key';
/** Set on a response the server replays from a stored submission. */
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';
export const IDEMPOTENCY_TTL_HOURS = 24;
/** What a key must look like; anything else is `IDEMPOTENCY_KEY_INVALID`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
