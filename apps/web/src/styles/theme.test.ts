import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PALETTES } from '@pallet/shared';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(join(__dirname, 'globals.css'), 'utf8');

function declarations(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((match) => [match[1] ?? '', match[2]?.trim() ?? '']),
  );
}

/** The body of the first rule whose selector list starts with `selector`. */
function ruleBody(selector: RegExp): string {
  const match = selector.exec(CSS);
  if (!match) throw new Error(`no rule for ${selector}`);
  const open = CSS.indexOf('{', match.index);
  return CSS.slice(open + 1, CSS.indexOf('}', open));
}

const KNOB_DEFAULTS = declarations(ruleBody(/^:root\s*\{/m));
const LIGHT = declarations(ruleBody(/^:root,\s*\n\.preview-light\s*\{/m));
const DARK = declarations(ruleBody(/\.dark,\s*\n\s*\.preview-dark\s*\{/));

function knobsOf(palette: string): Record<string, string> {
  return { ...KNOB_DEFAULTS, ...declarations(ruleBody(new RegExp(`\\[data-palette='${palette}'\\]\\s*\\{`))) };
}

/** Substitutes the theme's knobs and works out each `calc()`, leaving a plain `oklch(l c h)`. */
function resolve(value: string, knobs: Record<string, string>): string {
  const substituted = value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
    const knob = knobs[name];
    if (knob === undefined) throw new Error(`unknown knob --${name} in ${value}`);
    return knob;
  });
  return substituted.replace(/calc\(([^()]+)\)/g, (_, expression: string) => {
    if (!/^[\d\s.+*-]+$/.test(expression)) throw new Error(`unexpected calc: ${expression}`);
    return String(Number(new Function(`return (${expression});`)()));
  });
}

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
  // Links, status text and the focus ring drawn straight on the page or a card.
  ['primary', 'background'],
  ['primary', 'card'],
  ['destructive', 'background'],
  ['ring', 'background'],
  // The sidebar and its current page, table headers and striped rows (Q50).
  ['sidebar-foreground', 'sidebar'],
  ['muted-foreground', 'sidebar'],
  ['sidebar-accent-foreground', 'sidebar-accent'],
  ['foreground', 'table-header'],
  ['muted-foreground', 'table-header'],
  ['foreground', 'table-stripe'],
  ['muted-foreground', 'table-stripe'],
  ['primary', 'table-stripe'],
];

/** The outline that shows where a field or control is: WCAG AA for non-text contrast. */
const CONTROL_PAIRS: [string, string][] = [
  ['input', 'background'],
  ['input', 'card'],
  ['input', 'popover'],
  ['input', 'muted'],
];

describe('theme tokens (§7.12, Q50)', () => {
  it('define every colour theme the preferences offer, and nothing else', () => {
    const defined = [...CSS.matchAll(/\[data-palette='([\w-]+)'\]/g)].map((match) => match[1]);
    expect(defined).toEqual([...PALETTES]);
  });

  it('keep text at 4.5 : 1 and field outlines at 3 : 1 on their surfaces, in every theme, light and dark', () => {
    const failing: string[] = [];
    for (const palette of PALETTES) {
      const knobs = knobsOf(palette);
      for (const [mode, ramp] of [
        ['light', LIGHT],
        ['dark', DARK],
      ] as const) {
        const token = (name: string) => resolve(ramp[name] ?? '', knobs);
        for (const [text, surface] of TEXT_PAIRS) {
          const ratio = contrast(token(text), token(surface));
          if (ratio < 4.5) failing.push(`${palette} ${mode} ${text} on ${surface}: ${ratio.toFixed(2)}`);
        }
        for (const [outline, surface] of CONTROL_PAIRS) {
          const ratio = contrast(token(outline), token(surface));
          if (ratio < 3) failing.push(`${palette} ${mode} ${outline} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }
    expect(failing).toEqual([]);
  });

  it('give the light and the dark ramp the same tokens', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('measures contrast the WCAG way', () => {
    expect(contrast('oklch(1 0 0)', 'oklch(0 0 0)')).toBeCloseTo(21, 1);
    expect(contrast('oklch(0.5 0 0)', 'oklch(0.5 0 0)')).toBeCloseTo(1, 5);
    expect(resolve('oklch(0.5 calc(0.02 * var(--t)) var(--h))', { t: '0.5', h: '200' })).toBe('oklch(0.5 0.01 200)');
  });
});
