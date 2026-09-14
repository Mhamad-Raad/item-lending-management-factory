# shadcn RTL audit

§7.11.1 of `ARCHITECTURE.md` lists, per generated component, the changes that make it work right to
left. Each component in `apps/web/src/components/ui/` is ticked here once those changes are in. A new
component is added to this list in the same commit as the component.

| Component       | Checked | Notes                                                                                                                                                                                                               |
| --------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert`         | [x]     | No physical classes.                                                                                                                                                                                                |
| `badge`         | [x]     | No physical classes; icons spaced with `gap`.                                                                                                                                                                       |
| `button`        | [x]     | Icon spacing with `gap`, no `mr-2`/`ml-2`. Presses to 98 % through CSS `active:scale-[0.98]` on every button, `asChild` or not (Q45: motion's `whileTap` broke Enter on Radix triggers).                            |
| `calendar`      | [x]     | `dir` from the preferences, `weekStartsOn={6}`, month and weekday names from `common.months.*` / `common.weekdaysShort.*`, `numerals="latn"`; react-day-picker flips its own navigation with `dir`.                 |
| `card`          | [x]     | No physical classes.                                                                                                                                                                                                |
| `checkbox`      | [x]     | Label spacing with `gap`.                                                                                                                                                                                           |
| `command`       | [x]     | Input icon spaced with `gap`, no margins.                                                                                                                                                                           |
| `dialog`        | [x]     | Close button at `end-4`, 40 px below `md` (§7.15); header `text-start` with `pe-8` to clear it; footer uses `gap-2`. Built on `panel`: fades and scales with motion; focus returns to the opener.                   |
| `dropdown-menu` | [x]     | The user menu only: content and items use `gap`, no `SubTrigger`, `CheckboxItem`, `RadioItem` or `Shortcut`; opened with `align="end"` and `side` top or bottom, never left or right.                               |
| `input`         | [x]     | No `text-left`; no `file:` margins.                                                                                                                                                                                 |
| `label`         | [x]     | No physical classes.                                                                                                                                                                                                |
| `panel`         | [x]     | Not generated: what `dialog` and `sheet` share — the open state kept through the exit, the overlay, focus returned to the opener, contents inert while leaving, and the close button at `end-4` of full touch size. |
| `popover`       | [x]     | Never given `side="left"` or `side="right"`; aligned to `start`.                                                                                                                                                    |
| `radio-group`   | [x]     | Item layout uses `gap-2`.                                                                                                                                                                                           |
| `select`        | [x]     | Item `ps-2 pe-8`, indicator at `end-2`.                                                                                                                                                                             |
| `skeleton`      | [x]     | No physical classes.                                                                                                                                                                                                |
| `sonner`        | [x]     | `top-center`, direction from the preferences, `richColors` in the §7.12 tokens (sonner's own palette misses AA), `closeButton`; the close button and the toaster region are labelled from the locale files.         |
| `switch`        | [x]     | Thumb adds `rtl:data-[state=checked]:-translate-x-4`.                                                                                                                                                               |
| `table`         | [x]     | `TableHead` is `text-start` and `scope="col"` by default; numeric columns use `text-end`.                                                                                                                           |
| `tabs`          | [x]     | List starts at inline-start; triggers use `gap`; `dir` from the preferences so arrow keys follow the reading direction.                                                                                             |
| `sheet`         | [x]     | Bottom and inline-start sides; the start side slides in from the right in Kurdish and Arabic (motion, `x` from ±100 %). Built on `panel`, which draws the close button at `end-4`.                                  |
| `textarea`      | [x]     | No `text-left`; text starts at inline-start.                                                                                                                                                                        |

## Directional icons and typed text

Icons that point a way (§7.11's list) come from `src/components/app/dir-icon.tsx`, which mirrors them with
`rtl:-scale-x-100`; `rtl-classes.test.ts` refuses a direct lucide import of any of them. Names, notes and
labels people typed are isolated with `<bdi>`, or with U+2068/U+2069 inside a translated sentence (Q43);
`e2e/rtl.spec.ts` walks the pages that show them in Kurdish.

## Contrast

Since Q50 every token is derived from a colour theme's knobs, and the test runs every pair for all
seven themes in light and dark (including the sidebar, table header and striped-row tokens). The ratios
below are the default `harbor` theme's; any theme falling under a threshold fails the build.

§7.12 asks for each token pair's ratio to be recorded here. The ratios below are computed from
`apps/web/src/styles/globals.css` (OKLCH to sRGB, WCAG relative luminance). `src/styles/theme.test.ts`
recomputes them on every run: text needs 4.5 : 1 or more and a field's outline 3 : 1 or more, or the
build fails. The soft badge colours, which blend a token with the surface, are measured in the browser by
`e2e/styles.spec.ts`. The three daily flows are checked in both themes by axe (`e2e/a11y.spec.ts`).

| Pair                                          | Light | Dark  |
| --------------------------------------------- | ----- | ----- |
| `--foreground` on `--background`              | 17.33 | 17.02 |
| `--card-foreground` on `--card`               | 18.09 | 15.77 |
| `--popover-foreground` on `--popover`         | 18.09 | 15.77 |
| `--primary-foreground` on `--primary`         | 7.29  | 8.16  |
| `--secondary-foreground` on `--secondary`     | 13.82 | 12.63 |
| `--muted-foreground` on `--background`        | 6.52  | 8.30  |
| `--muted-foreground` on `--muted`             | 5.98  | 6.74  |
| `--muted-foreground` on `--card`              | 6.81  | 7.69  |
| `--accent-foreground` on `--accent`           | 13.44 | 11.78 |
| `--destructive-foreground` on `--destructive` | 5.69  | 6.11  |
| `--success-foreground` on `--success`         | 5.49  | 9.03  |
| `--warning-foreground` on `--warning`         | 5.49  | 10.11 |
| `--info-foreground` on `--info`               | 5.65  | 9.02  |
| `--primary` on `--background`                 | 7.19  | 8.29  |
| `--destructive` on `--background`             | 5.61  | 6.08  |
| `--success` on `--background`                 | 5.41  | 9.07  |
| `--warning` on `--background`                 | 5.42  | 10.09 |
| `--info` on `--background`                    | 5.57  | 9.04  |
| `--ring` on `--background`                    | 7.19  | 8.29  |
| `--border` on `--background`                  | 1.42  | 1.63  |
| `--input` on `--background`                   | 3.77  | 3.95  |
| `--input` on `--card`                         | 3.94  | 3.66  |

`--border` draws dividers between rows and cards. It carries no information of its own, so it keeps
§7.12's quiet value. `--input` outlines fields, checkboxes, radios and switches, and is darker than §7.12
gives, to reach 3 : 1 (Q44).
