/**
 * Isolates text people typed inside a translated sentence (§7.11), with the Unicode first-strong isolate
 * marks — the plain-string form of `<bdi>`. A Latin name such as "Euro pallet 1200 × 800, heat treated"
 * otherwise has its numbers and punctuation reordered by the Kurdish or Arabic sentence around it.
 */
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}
