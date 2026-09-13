import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { createContext, useContext, useRef } from 'react';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { isRtl, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

// shadcn/ui sheet (new-york), bottom and inline-start sides: the daily flows' summary below `lg`
// (§7.4) and the navigation drawer below `lg` (§7.5). RTL-audited: `start` uses logical insets, so
// the drawer opens from the right in Kurdish and Arabic; the close button sits at `end-4`.
const SheetOpen = createContext(false);

/** Always controlled, like `Dialog`: the panel slides in and out with `open` (§7.14). */
export function Sheet({
  open,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { open: boolean }) {
  return (
    <DialogPrimitive.Root open={open} {...props}>
      <SheetOpen.Provider value={open}>{children}</SheetOpen.Provider>
    </DialogPrimitive.Root>
  );
}

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
  children,
  closeLabel,
  side = 'bottom',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string; side?: keyof typeof SIDES }) {
  const open = useContext(SheetOpen);
  // Opened from a plain button rather than a Radix trigger, Radix would drop focus on <body> when it closes:
  // focus goes back to whatever had it when the panel opened (§7.15).
  const opener = useRef<HTMLElement | null>(null);
  const rtl = isRtl(usePreferences().language);
  const hidden = offscreen(side, rtl);
  return (
    <AnimatePresence>
      {open ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              className="fixed inset-0 z-50 bg-black/50"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: DURATION.base } }}
              exit={{ opacity: 0, transition: { duration: DURATION.fast } }}
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content
            asChild
            forceMount
            {...props}
            onOpenAutoFocus={(event) => {
              opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
              props.onOpenAutoFocus?.(event);
            }}
            onCloseAutoFocus={(event) => {
              props.onCloseAutoFocus?.(event);
              if (event.defaultPrevented) return;
              event.preventDefault();
              if (opener.current?.isConnected) opener.current.focus();
            }}
          >
            <motion.div
              data-slot="sheet-content"
              className={cn(
                'bg-background fixed z-50 flex flex-col gap-4 overflow-y-auto shadow-lg',
                SIDES[side],
                className,
              )}
              initial={hidden}
              animate={{ x: 0, y: 0, transition: { duration: DURATION.base, ease: EASE_OUT } }}
              exit={{ ...hidden, transition: { duration: DURATION.fast } }}
            >
              {children}
              <DialogPrimitive.Close className="absolute end-4 top-4 flex size-10 items-center justify-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:size-9">
                <X className="size-4" aria-hidden />
                <span className="sr-only">{closeLabel}</span>
              </DialogPrimitive.Close>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
