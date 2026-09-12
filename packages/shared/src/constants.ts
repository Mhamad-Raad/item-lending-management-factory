/** A normalised phone number: an optional `+`, then 7–15 digits (Q13). The database checks the same. */
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;

/** The longest search term a list accepts (§6.2); the web box stops typing at the same length. */
export const SEARCH_MAX_LENGTH = 100;
