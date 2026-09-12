import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// shadcn/ui sheet (new-york), bottom and inline-start sides: the daily flows' summary below `lg`
// (§7.4) and the navigation drawer below `lg` (§7.5). RTL-audited: `start` uses logical insets, so
// the drawer opens from the right in Kurdish and Arabic; the close button sits at `end-4`.
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetTitle = DialogPrimitive.Title;
export const SheetClose = DialogPrimitive.Close;

const SIDES = {
  bottom: 'inset-x-0 bottom-0 max-h-[85dvh] rounded-t-lg border-t p-6',
  start:
    'inset-y-0 start-0 h-dvh w-72 max-w-[85vw] border-e p-0 data-[state=open]:slide-in-from-start data-[state=closed]:slide-out-to-start',
} as const;

export function SheetContent({
  className,
  children,
  closeLabel,
  side = 'bottom',
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string; side?: keyof typeof SIDES }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 overflow-y-auto shadow-lg',
          SIDES[side],
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="focus-visible:ring-ring/50 absolute end-4 top-4 flex size-9 items-center justify-center rounded-md opacity-70 outline-none hover:opacity-100 focus-visible:ring-[3px]">
          <X className="size-4" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
