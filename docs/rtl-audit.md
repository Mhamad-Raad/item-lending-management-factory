# shadcn RTL audit

§7.11.1 of `ARCHITECTURE.md` lists, per generated component, the changes that make it work right to
left. Each component in `apps/web/src/components/ui/` is ticked here once those changes are in. A new
component is added to this list in the same commit as the component.

| Component       | Checked | Notes                                                                                                                                                                                               |
| --------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `alert`         | [x]     | No physical classes.                                                                                                                                                                                |
| `badge`         | [x]     | No physical classes; icons spaced with `gap`.                                                                                                                                                       |
| `button`        | [x]     | Icon spacing with `gap`, no `mr-2`/`ml-2`. `whileTap` press (§7.14) not added yet.                                                                                                                  |
| `calendar`      | [x]     | `dir` from the preferences, `weekStartsOn={6}`, month and weekday names from `common.months.*` / `common.weekdaysShort.*`, `numerals="latn"`; react-day-picker flips its own navigation with `dir`. |
| `card`          | [x]     | No physical classes.                                                                                                                                                                                |
| `checkbox`      | [x]     | Label spacing with `gap`.                                                                                                                                                                           |
| `command`       | [x]     | Input icon spaced with `gap`, no margins.                                                                                                                                                           |
| `dialog`        | [x]     | Close button at `end-4`; header `text-start`; footer uses `gap-2`. Motion animation (§7.14) not added yet.                                                                                          |
| `dropdown-menu` | [x]     | The user menu only: content and items use `gap`, no `SubTrigger`, `CheckboxItem`, `RadioItem` or `Shortcut`; opened with `align="end"` and `side` top or bottom, never left or right.               |
| `input`         | [x]     | No `text-left`; no `file:` margins.                                                                                                                                                                 |
| `label`         | [x]     | No physical classes.                                                                                                                                                                                |
| `popover`       | [x]     | Never given `side="left"` or `side="right"`; aligned to `start`.                                                                                                                                    |
| `radio-group`   | [x]     | Item layout uses `gap-2`.                                                                                                                                                                           |
| `select`        | [x]     | Item `ps-2 pe-8`, indicator at `end-2`.                                                                                                                                                             |
| `skeleton`      | [x]     | No physical classes.                                                                                                                                                                                |
| `sonner`        | [x]     | Direction from the preferences.                                                                                                                                                                     |
| `switch`        | [x]     | Thumb adds `rtl:data-[state=checked]:-translate-x-4`.                                                                                                                                               |
| `table`         | [x]     | `TableHead` is `text-start`; numeric columns use `text-end`.                                                                                                                                        |
| `tabs`          | [x]     | List starts at inline-start; triggers use `gap`; `dir` from the preferences so arrow keys follow the reading direction.                                                                             |
| `sheet`         | [x]     | Bottom side only (the daily flows' summary); close button at `end-4`.                                                                                                                               |
| `textarea`      | [x]     | No `text-left`; text starts at inline-start.                                                                                                                                                        |

## Directional icons and typed text

Icons that point a way (§7.11's list) come from `src/components/app/dir-icon.tsx`, which mirrors them with
`rtl:-scale-x-100`; `rtl-classes.test.ts` refuses a direct lucide import of any of them. Names, notes and
labels people typed are isolated with `<bdi>`, or with U+2068/U+2069 inside a translated sentence (Q43);
`e2e/rtl.spec.ts` walks the pages that show them in Kurdish.
