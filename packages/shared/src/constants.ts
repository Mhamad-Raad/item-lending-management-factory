/** A normalised phone number: an optional `+`, then 7–15 digits (Q13). The database checks the same. */
export const PHONE_PATTERN = /^\+?[0-9]{7,15}$/;
