import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, type HTMLMotionProps } from 'motion/react';
import { createContext, useContext, useRef } from 'react';
import { DURATION } from '@/lib/motion';

// What a dialog and a sheet share: a Radix dialog that knows its `open` state while its panel animates out
// (§7.14), an overlay, focus handed back to the opener, contents inert while leaving, and the close button.

const PanelOpen = createContext(false);

/**
 * Always controlled: the panel animates in and out with `open` (§7.14), so it has to know it while Radix still holds
 * the portal for the exit.
 */
export function PanelRoot({
  open,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { open: boolean }) {
  return (
    <DialogPrimitive.Root open={open} {...props}>
      <PanelOpen.Provider value={open}>{children}</PanelOpen.Provider>
    </DialogPrimitive.Root>
  );
}

/**
 * A panel's contents, which take no more input once `AnimatePresence` has begun to remove the panel: an Enter during
 * the fade would submit a form a second time. The flag comes from presence, not from `open` — a leaving child is
 * rendered from the element cached while it was still open.
 */
function InertWhileLeaving({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  return (
    <div className="contents" inert={!present}>
      {children}
    </div>
  );
}

/**
 * The portal of a dialog or sheet: overlay fade, then `panel` — the motion props of the panel itself, its look and
 * its movement — around the children and a close button of full touch size (§7.15).
 */
export function PanelContent({
  children,
  closeLabel,
  panel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  closeLabel: string;
  panel: HTMLMotionProps<'div'> & { 'data-slot': string };
}) {
  const open = useContext(PanelOpen);
  // Opened from a plain button rather than a Radix trigger, Radix would drop focus on <body> when it closes: focus goes
  // back to whatever had it when the panel opened (§7.15).
  const opener = useRef<HTMLElement | null>(null);
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
            <motion.div {...panel}>
              <InertWhileLeaving>
                {children}
                <DialogPrimitive.Close className="absolute end-4 top-4 flex size-10 items-center justify-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background md:size-9">
                  <X className="size-4" aria-hidden />
                  <span className="sr-only">{closeLabel}</span>
                </DialogPrimitive.Close>
              </InertWhileLeaving>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </AnimatePresence>
  );
}
