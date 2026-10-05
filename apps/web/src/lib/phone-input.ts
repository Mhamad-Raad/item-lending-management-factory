/**
 * What a phone box keeps of what is typed into it: digits — Western, or the Eastern ones of an Arabic or Kurdish
 * keyboard, which `normalizePhone` reads on save — one `+` at the very start, and the spaces, dashes and
 * parentheses people group a number with. Letters and every other sign are dropped as they are typed.
 */
export function keepPhoneCharacters(text: string): string {
  const kept = text.replace(/[^0-9٠-٩۰-۹+\s()-]/g, '');
  // A plus sign means "international" only in front of the number: one with anything but space before it goes.
  return kept.replace(/\+/g, (plus, index: number) => (kept.slice(0, index).trim() === '' ? plus : ''));
}
