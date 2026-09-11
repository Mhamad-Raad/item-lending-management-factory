/** No look-alike characters: the admin reads this out loud to the new user. */
const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const LENGTH = 16;

/** A readable initial password, from the platform's cryptographic source (§7.3.19). */
export function generatePassword(): string {
  const bytes = new Uint32Array(LENGTH);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => ALPHABET[value % ALPHABET.length]).join('');
}
