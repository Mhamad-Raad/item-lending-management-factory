import { useCallback, useEffect, useRef, useState } from 'react';

/** The faces the receipt sets its text in (`receipt.css`). */
const RECEIPT_FONTS = ['"Noto Sans Arabic Variable"', '"Inter Variable"'];

/** A logo that has neither loaded nor failed by then is not waited for: the receipt prints without it. */
const LOGO_WAIT_MS = 10_000;

/**
 * The logo's part of a receipt's readiness (§7.16.1): ready when there is none, when its `<img>` has fired `load` or
 * `error` (`onLogoSettled`), or after `LOGO_WAIT_MS` — a stalled image must not hold the print for ever.
 */
export function useLogoGate(hasLogo: boolean): { logoReady: boolean; onLogoSettled: () => void } {
  const [settled, setSettled] = useState(false);
  const onLogoSettled = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (!hasLogo) return;
    const timer = setTimeout(onLogoSettled, LOGO_WAIT_MS);
    return () => clearTimeout(timer);
  }, [hasLogo, onLogoSettled]);
  return { logoReady: !hasLogo || settled, onLogoSettled };
}

/** Calls `print` once, the first time `ready` is true. */
export function usePrintOnce(ready: boolean, print: () => Promise<void>): void {
  const printed = useRef(false);
  useEffect(() => {
    if (!ready || printed.current) return;
    printed.current = true;
    void print();
  }, [ready, print]);
}

/**
 * Resolves once the receipt's fonts are loaded in `doc` for the text it holds — printed before, the receipt comes out
 * in a fallback font with the wrong script widths (§7.16.1). The faces are asked for by name, not left to layout: a
 * document that has not been laid out since its text arrived may have started no font load yet, and `fonts.ready`
 * would then resolve at once.
 */
export async function fontsSettled(doc: Document): Promise<void> {
  const text = doc.body.textContent ?? '';
  await Promise.all(RECEIPT_FONTS.map((family) => doc.fonts.load(`10pt ${family}`, text).catch(() => [])));
  await doc.fonts.ready;
}
