import { Dialog as DialogPrimitive } from 'radix-ui';
import { PanelContent, PanelRoot } from '@/components/ui/panel';
import { DURATION, EASE_OUT } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** Always controlled: the content animates in and out with `open` (§7.14). */
export const Dialog = PanelRoot;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

/**
 * Overlay fades, content fades and grows from 98 % (§7.14); both stay mounted through their exit. Below
 * `sm` the dialog takes the width and scrolls within 90 % of the screen height (§7.15).
 */
export function DialogContent({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  return (
    <PanelContent
      {...props}
      panel={{
        'data-slot': 'dialog-content',
        className: cn(
          'bg-background fixed top-1/2 left-1/2 z-50 grid max-h-[90dvh] w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border p-6 shadow-lg sm:max-w-lg', // rtl-ok: centred with -translate-x-1/2, the same in both directions
          className,
        ),
        initial: { opacity: 0, scale: 0.98 },
        animate: { opacity: 1, scale: 1, transition: { duration: DURATION.base, ease: EASE_OUT } },
        exit: { opacity: 0, scale: 0.98, transition: { duration: DURATION.fast } },
      }}
    />
  );
}

export function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  // Clear of the close button in the top end corner.
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 pe-8 text-start', className)} {...props} />;
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
