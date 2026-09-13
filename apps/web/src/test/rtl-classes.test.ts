import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
/** Generated, or laid out in millimetres and always right to left (§7.16). */
const EXCLUDED = new Set(['routeTree.gen.ts', 'features/receipt/receipt.css']);

/**
 * §7.11 (Q43): physical-side Tailwind utilities with any variant or negative prefix, slide animations
 * without their `ltr:`/`rtl:` pair, `left`/`right` given as a value, physical CSS properties and their
 * inline-style spellings. A line may keep one with `// rtl-ok: <reason>`.
 */
const PHYSICAL = new RegExp(
  [
    String.raw`(?<![\w-])-?(?:ml|mr|pl|pr|left|right|inset-l|inset-r|space-x|rounded-[tb]?[lr]|border-[lr]|scroll-m[lr]|scroll-p[lr])-[\w./[\]%]+`,
    String.raw`(?<![\w-])(?:border-[lr]|rounded-[tb]?[lr]|text-left|text-right|float-left|float-right|origin-(?:top-|bottom-)?(?:left|right)|bg-(?:linear|gradient)-to-[lr])(?![\w-])`,
    String.raw`['"\x60](?:left|right)['"\x60]`,
    String.raw`(?<![\w-])(?:margin|padding|border|inset)-(?:left|right)(?![\w-])`,
    String.raw`(?<![\w-])(?:left|right)\s*:`,
    String.raw`\b(?:margin|padding|border)(?:Left|Right)\b`,
    String.raw`text-align\s*:\s*(?:left|right)`,
  ].join('|'),
);

/** A slide from a physical side is kept only as one half of its `ltr:`/`rtl:` pair (§7.11). */
const SLIDE = /(?<![\w-])([\w[\]=&-]*:)*(?:slide-in-from|slide-out-to)-(?:left|right)(?![\w-])/g;

/** A sideways translation positions or toggles something: it needs its mirrored `rtl:` counterpart. */
const TRANSLATE_X = /(?<![\w:-])-?translate-x-[\w./[\]%()-]+/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * The physical-side uses in a file, as `line text`. Comments explain in words ("reads left to right") and
 * are not checked: a block comment only opens where a line starts with one, so `accept="image/*"` in a
 * string does not hide the rest of the file.
 */
function offencesIn(source: string): string[] {
  const offences: string[] = [];
  let inBlockComment = false;
  source.split('\n').forEach((raw, index) => {
    const trimmed = raw.trim();
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      return;
    }
    if (/^(\/\*|\{\/\*)/.test(trimmed)) {
      inBlockComment = !trimmed.includes('*/');
      return;
    }
    if (trimmed.startsWith('*') || trimmed.startsWith('//') || raw.includes('// rtl-ok:')) return;
    const code = raw.replace(/\{?\/\*.*?\*\/\}?/g, '').replace(/(^|[^:'"])\/\/.*$/, '$1');
    const match = PHYSICAL.exec(code);
    if (match) offences.push(`${index + 1} ${match[0]}`);
    for (const slide of code.matchAll(SLIDE)) {
      if (!/(?:^|:)(?:ltr|rtl):/.test(slide[0])) offences.push(`${index + 1} ${slide[0]} without its ltr:/rtl: pair`);
    }
    const translate = TRANSLATE_X.exec(code);
    if (
      translate &&
      !/rtl:[\w:[\]=-]*-?translate-x-/.test(code) &&
      !/rtl:[\w:[\]=-]*-?translate-x-/.test(translate[0])
    ) {
      offences.push(`${index + 1} ${translate[0]} without its rtl: counterpart`);
    }
  });
  return offences;
}

/** §7.11's icons that point a way; ArrowLeftRight points both ways and is not flipped. */
const DIRECTIONAL = [
  'ChevronLeft',
  'ChevronRight',
  'ChevronsLeft',
  'ChevronsRight',
  'ArrowLeft',
  'ArrowRight',
  'Undo2',
  'Redo2',
  'LogOut',
  'LogIn',
  'CornerDownLeft',
  'CornerDownRight',
];

/** The directional icons a file imports from lucide itself, under any of lucide's names or an alias. */
function directionalImports(source: string): string[] {
  const imported = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from\s*['"]lucide-react['"]/g)].flatMap(
    (match) =>
      (match[1] ?? '')
        .split(',')
        .map(
          (name) =>
            name
              .trim()
              .replace(/^type\s+/, '')
              .split(/\s+as\s+/)[0] ?? '',
        )
        .filter(Boolean),
  );
  return DIRECTIONAL.filter((icon) =>
    imported.some((name) => name === icon || name === `${icon}Icon` || name === `Lucide${icon}`),
  );
}

describe('logical properties only (§7.11)', () => {
  it('uses no physical-side utility or CSS outside an rtl-ok line', () => {
    const offences = sources(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      return EXCLUDED.has(file) ? [] : offencesIn(readFileSync(path, 'utf8')).map((offence) => `${file}:${offence}`);
    });
    expect(offences).toEqual([]);
  });

  it('catches every physical form, and lets logical ones and reasoned exceptions through', () => {
    const caught = [
      '<div className="ml-2 flex">',
      '<div className="md:pr-4 border-l">',
      "side: 'right',",
      'margin-left: 4px;',
      'left: auto;',
      'inset-inline: 0; right: calc(1rem + 2px);',
      'style={{ marginLeft: 8 }}',
      'className="data-[state=open]:slide-in-from-left"',
      'className="origin-top-left scroll-ml-4"',
      'className="bg-linear-to-r"',
      'className="translate-x-4"',
    ];
    for (const line of caught) expect(offencesIn(line), line).not.toEqual([]);

    const allowed = [
      '<div className="ms-2 ps-4 text-start end-4">',
      'const pr = previous;',
      '// A phone number reads left to right.',
      'className="ltr:slide-in-from-left rtl:slide-in-from-right"',
      'className="data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4"',
      'className="left-1/2 -translate-x-1/2", // rtl-ok: centred',
    ];
    for (const line of allowed) expect(offencesIn(line), line).toEqual([]);

    // A string that merely contains "/*" does not stop the scan.
    expect(offencesIn('<input accept="image/*" />\n<div className="mr-2" />')).toEqual(['2 mr-2']);
  });

  it('draws the icons that point a way only through DirIcon, which mirrors them right to left', () => {
    const offences = sources(SRC).flatMap((path) => {
      const file = relative(SRC, path);
      if (file === 'components/app/dir-icon.tsx') return [];
      return directionalImports(readFileSync(path, 'utf8')).map((icon) => `${file} ${icon}`);
    });
    expect(offences).toEqual([]);

    expect(
      directionalImports("import { Plus } from 'lucide-react';\nimport { ChevronLeft as Back } from 'lucide-react';"),
    ).toEqual(['ChevronLeft']);
    expect(directionalImports("import { LogOutIcon, LucideUndo2, Package } from 'lucide-react';")).toEqual([
      'Undo2',
      'LogOut',
    ]);
  });
});
