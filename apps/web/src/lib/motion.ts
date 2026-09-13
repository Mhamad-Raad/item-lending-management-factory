/** Motion tokens (§7.14): 150–300 ms only, one easing. */
export const DURATION = { fast: 0.15, base: 0.2, slow: 0.3 } as const;
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const dirX = (dir: 'ltr' | 'rtl', px: number): number => (dir === 'rtl' ? -px : px);
