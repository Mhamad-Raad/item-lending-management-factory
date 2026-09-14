import { Dialog as DialogPrimitive } from 'radix-ui';
import { PanelContent, PanelRoot } from '@/components/ui/panel';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { isRtl, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

// shadcn/ui sheet (new-york), bottom and inline-start sides: the daily flows' summary below `lg`
// (§7.4) and the navigation drawer below `lg` (§7.5). RTL-audited: `start` uses logical insets, so
// the drawer opens from the right in Kurdish and Arabic; the close button sits at `end-4`.

/** Always controlled, like `Dialog`: the panel slides in and out with `open` (§7.14). */
export const Sheet = PanelRoot;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetTitle = DialogPrimitive.Title;
export const SheetClose = DialogPrimitive.Close;

const SIDES = {
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t p-6',
  start: 'inset-y-0 start-0 h-dvh w-72 max-w-[85vw] border-e p-0',
} as const;

/** Where each side slides in from: the reading start is the right edge in Kurdish and Arabic. */
function offscreen(side: keyof typeof SIDES, rtl: boolean): { x?: string; y?: string } {
  return side === 'bottom' ? { y: '100%' } : { x: rtl ? '100%' : '-100%' };
}

export function SheetContent({
  className,
  side = 'bottom',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string; side?: keyof typeof SIDES }) {
  const hidden = offscreen(side, isRtl(usePreferences().language));
  return (
    <PanelContent
      {...props}
      panel={{
        'data-slot': 'sheet-content',
        className: cn('bg-background fixed z-50 flex flex-col gap-4 overflow-y-auto shadow-lg', SIDES[side], className),
        initial: hidden,
        animate: { x: 0, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } },
        exit: { ...hidden, transition: { duration: DURATION.fast } },
      }}
    />
  );
}
