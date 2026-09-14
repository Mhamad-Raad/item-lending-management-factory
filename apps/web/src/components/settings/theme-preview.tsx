import type { Palette, ResolvedTheme, Theme } from '@pallet/shared';
import { cn } from '@/lib/utils';

/**
 * A miniature screen — sidebar, title, figures and a striped table — drawn only from the design tokens. The
 * `preview-light` / `preview-dark` classes declare the ramp again on this box and `data-palette` sets its knobs,
 * so the miniature shows a theme that is not the one on screen (Q50).
 */
function Miniature({ mode, palette }: { mode: ResolvedTheme; palette: Palette }) {
  return (
    <div
      data-palette={palette}
      className={cn('bg-background flex h-24', mode === 'dark' ? 'preview-dark' : 'preview-light')}
    >
      <div className="bg-sidebar flex w-11 shrink-0 flex-col gap-1.5 border-e p-1.5">
        <div className="bg-primary h-2.5 rounded-sm" />
        <div className="bg-sidebar-accent h-2 rounded-sm" />
        <div className="bg-muted h-2 rounded-sm" />
        <div className="bg-muted h-2 rounded-sm" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
        <div className="flex items-center justify-between gap-2">
          <div className="bg-foreground/70 h-2 w-12 rounded-sm" />
          <div className="bg-primary size-3 shrink-0 rounded-full" />
        </div>
        <div className="grid grid-cols-3 gap-1">
          {['bg-primary', 'bg-success', 'bg-warning'].map((tone) => (
            <div key={tone} className="bg-card flex flex-col gap-1 rounded-sm border p-1">
              <div className="bg-muted h-1 w-2/3 rounded-xs" />
              <div className={cn('h-1.5 w-1/2 rounded-xs', tone)} />
            </div>
          ))}
        </div>
        <div className="bg-card flex flex-col overflow-hidden rounded-sm border">
          <div className="bg-table-header h-1.5" />
          <div className="bg-card h-1.5" />
          <div className="bg-table-stripe h-1.5" />
        </div>
      </div>
    </div>
  );
}

/** The app in `mode`: `system` cannot honestly be one screen, so it shows both halves. */
export function ThemePreview({ mode, palette }: { mode: Theme; palette: Palette }) {
  if (mode === 'system') {
    return (
      <div className="grid grid-cols-2" aria-hidden>
        <Miniature mode="light" palette={palette} />
        <Miniature mode="dark" palette={palette} />
      </div>
    );
  }
  return (
    <div aria-hidden>
      <Miniature mode={mode} palette={palette} />
    </div>
  );
}
