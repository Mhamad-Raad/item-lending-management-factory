/**
 * Fits a pallet type's name to its cell (Q183): one line when it fits; else two, smaller; else three, smaller still,
 * ending in "…" past that — so the row keeps its 7 mm. Set on the element itself, not in React state, so a print can
 * fit every name at once, synchronously, in the fonts it prints in. One line is judged by its width; two by the height
 * the text takes unclamped, with half a line to spare (the tall marks of Sorani never count) — the same in every engine.
 */
export function fitItemName(element: HTMLElement): void {
  element.dataset.lines = '1';
  if (element.scrollWidth <= element.clientWidth + 1) return;
  element.dataset.lines = '2';
  element.dataset.probe = '';
  const height = element.getBoundingClientRect().height;
  const lineHeight = Number.parseFloat(element.ownerDocument.defaultView?.getComputedStyle(element).lineHeight ?? '');
  delete element.dataset.probe;
  if (Number.isFinite(lineHeight) && height <= lineHeight * 2.5) return;
  element.dataset.lines = '3';
}

/** Fits every pallet type's name in a document: called right before it prints, once its fonts are in (Q183). */
export function fitItemNames(doc: Document): void {
  for (const element of doc.querySelectorAll<HTMLElement>('.item-name')) fitItemName(element);
}
