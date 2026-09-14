import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { createContext, useContext, useRef } from 'react';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';

const DialogOpen = createContext(false);

/**
 * Always controlled: the content animates in and out with `open` (§7.14), so it has to know it while Radix
 * still holds the portal for the exit.
 */
export function Dialog({
  open,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root> & { open: boolean }) {
  return (
    <DialogPrimitive.Root open={open} {...props}>
      <DialogOpen.Provider value={open}>{children}</DialogOpen.Provider>
    </DialogPrimitive.Root>
  );
}

/**
 * A panel's contents, which take no more input once `AnimatePresence` has begun to remove the panel: an Enter
 * during the fade would submit a form a second time. The flag comes from presence, not from `open` — a leaving
 * child is rendered from the element cached while it was still open.
 */
export function InertWhileLeaving({ children }: { children: React.ReactNode }) {
  const present = useIsPresent();
  return (
    <div className="contents" inert={!present}>
      {children}
    </div>
  );
}

export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Overlay fades, content fades and grows from 98 % (§7.14); both stay mounted through their exit. Below
 * `sm` the dialog takes the width and scrolls within 90 % of the screen height (§7.15).
 */
export function DialogContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  const open = useContext(DialogOpen);
  // Opened from a plain button rather than a Radix trigger, Radix would drop focus on <body> when it closes:
  // focus goes back to whatever had it when the panel opened (§7.15).
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
            <motion.div
              data-slot="dialog-content"
              className={cn(
                'bg-background fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg sm:max-w-lg', // rtl-ok: centred with -translate-x-1/2, the same in both directions
                className,
              )}
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE_OUT } }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } }}
            >
              <InertWhileLeaving>
                {children}
                <DialogPrimitive.Close className="absolute end-4 top-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background">
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

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-start', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title data-slot="dialog-title" className={cn('text-lg font-semibold', className)} {...props} />
  );
}

export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-muted-foreground text-sm', className)}
      {...props}
    />
  );
}
