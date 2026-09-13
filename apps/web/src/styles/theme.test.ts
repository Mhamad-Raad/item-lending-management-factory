import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');

/** §7.12's token table, copied here as the outside truth the stylesheet is checked against. */
const SPEC: Record<string, [light: string, dark: string]> = {
  background: ['oklch(0.985 0.002 250)', 'oklch(0.17 0.01 250)'],
  foreground: ['oklch(0.2 0.02 250)', 'oklch(0.96 0.005 250)'],
  card: ['oklch(1 0 0)', 'oklch(0.21 0.012 250)'],
  'card-foreground': ['oklch(0.2 0.02 250)', 'oklch(0.96 0.005 250)'],
  popover: ['oklch(1 0 0)', 'oklch(0.21 0.012 250)'],
  'popover-foreground': ['oklch(0.2 0.02 250)', 'oklch(0.96 0.005 250)'],
  primary: ['oklch(0.45 0.13 255)', 'oklch(0.74 0.12 255)'],
  'primary-foreground': ['oklch(0.99 0 0)', 'oklch(0.18 0.03 255)'],
  secondary: ['oklch(0.95 0.01 250)', 'oklch(0.27 0.015 250)'],
  'secondary-foreground': ['oklch(0.25 0.02 250)', 'oklch(0.94 0.005 250)'],
  muted: ['oklch(0.955 0.006 250)', 'oklch(0.26 0.012 250)'],
  'muted-foreground': ['oklch(0.47 0.02 250)', 'oklch(0.74 0.015 250)'],
  accent: ['oklch(0.94 0.02 255)', 'oklch(0.3 0.03 255)'],
  'accent-foreground': ['oklch(0.25 0.05 255)', 'oklch(0.95 0.01 255)'],
  destructive: ['oklch(0.53 0.2 27)', 'oklch(0.68 0.19 25)'],
  'destructive-foreground': ['oklch(0.99 0 0)', 'oklch(0.17 0.02 25)'],
  success: ['oklch(0.5 0.13 150)', 'oklch(0.75 0.14 150)'],
  'success-foreground': ['oklch(0.99 0 0)', 'oklch(0.17 0.03 150)'],
  warning: ['oklch(0.52 0.14 70)', 'oklch(0.8 0.14 80)'],
  // Q44: §7.12's dark text on the light warning measures 3.5 : 1; white text passes.
  'warning-foreground': ['oklch(0.99 0 0)', 'oklch(0.17 0.03 80)'],
  info: ['oklch(0.5 0.13 240)', 'oklch(0.76 0.11 240)'],
  'info-foreground': ['oklch(0.99 0 0)', 'oklch(0.17 0.03 240)'],
  border: ['oklch(0.87 0.01 250)', 'oklch(0.34 0.015 250)'],
  // Q44: a field's outline needs 3 : 1 (WCAG 1.4.11); §7.12's shared border value measures 1.4 : 1.
  input: ['oklch(0.6 0.02 250)', 'oklch(0.55 0.02 250)'],
  ring: ['oklch(0.45 0.13 255)', 'oklch(0.74 0.12 255)'],
};

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1], match[2]?.trim()]),
  );
}

const light = tokens(/:root\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '');
const dark = tokens(/\.dark\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '');

/** OKLCH → relative luminance (WCAG), through OKLab and linear sRGB, clamped to the sRGB gamut. */
function luminance(color: string): number {
  const [l = 0, c = 0, h = 0] = (/oklch\(([^)]+)\)/.exec(color)?.[1] ?? '').trim().split(/\s+/).map(Number);
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const r = clamp(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_);
  const g = clamp(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_);
  const bl = clamp(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_);
  return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
}

function contrast(one: string, two: string): number {
  const [hi, lo] = [luminance(one), luminance(two)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Text on its surface: WCAG AA for body text (§7.12, §7.15). */
const TEXT_PAIRS: [string, string][] = [
  ['foreground', 'background'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['primary-foreground', 'primary'],
  ['secondary-foreground', 'secondary'],
  ['muted-foreground', 'background'],
  ['muted-foreground', 'muted'],
  ['muted-foreground', 'card'],
  ['accent-foreground', 'accent'],
  ['destructive-foreground', 'destructive'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['info-foreground', 'info'],
  // Links, status text and the focus ring drawn straight on the page.
  ['primary', 'background'],
  ['destructive', 'background'],
  ['ring', 'background'],
];

/** The outline that shows where a field or control is: WCAG AA for non-text contrast. */
const CONTROL_PAIRS: [string, string][] = [
  ['input', 'background'],
  ['input', 'card'],
  ['input', 'popover'],
  ['input', 'muted'],
];

describe('theme tokens (§7.12)', () => {
  it('are the specified palette, light and dark', () => {
    for (const [name, [lightValue, darkValue]] of Object.entries(SPEC)) {
      expect(light[name], `light --${name}`).toBe(lightValue);
      expect(dark[name], `dark --${name}`).toBe(darkValue);
    }
  });

  it('keep text at 4.5 : 1 and field outlines at 3 : 1 on their surfaces, in both themes', () => {
    const failing: string[] = [];
    for (const [theme, values] of [
      ['light', light],
      ['dark', dark],
    ] as const) {
      for (const [text, surface] of TEXT_PAIRS) {
        const ratio = contrast(values[text] ?? '', values[surface] ?? '');
        if (ratio < 4.5) failing.push(`${theme} ${text} on ${surface}: ${ratio.toFixed(2)}`);
      }
      for (const [outline, surface] of CONTROL_PAIRS) {
        const ratio = contrast(values[outline] ?? '', values[surface] ?? '');
        if (ratio < 3) failing.push(`${theme} ${outline} on ${surface}: ${ratio.toFixed(2)}`);
      }
    }
    expect(failing).toEqual([]);
  });

  it('measures contrast the WCAG way', () => {
    expect(contrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 1);
    expect(contrast('oklch(0.5 0 0)', 'oklch(0.5 0 0)')).toBeCloseTo(1, 5);
  });
});
