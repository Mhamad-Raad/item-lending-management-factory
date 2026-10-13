/** Scrolls to the table row or card named `anchor` (`DataTable`'s `rowAnchor`) that is shown at this width. */
export function scrollToAnchor(anchor: string): void {
  const shown = [...document.querySelectorAll<HTMLElement>(`[data-anchor="${CSS.escape(anchor)}"]`)].find(
    (element) => element.getClientRects().length > 0,
  );
  shown?.scrollIntoView({ block: 'start' });
}
