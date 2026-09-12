import { Dialog as DialogPrimitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// shadcn/ui sheet (new-york), bottom side only — what the daily flows' summary needs below `lg`
// (§7.4). RTL-audited: the close button sits at `end-4`; a bottom sheet has no inline side to flip.
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetTitle = DialogPrimitive.Title;

export function SheetContent({
  className,
  children,
  closeLabel,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & { closeLabel: string }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
      <DialogPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          'bg-background fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col gap-4 overflow-y-auto rounded-t-lg border-t p-6 shadow-lg',
          className,
        )}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="focus-visible:ring-ring/50 absolute end-4 top-4 rounded-xs opacity-70 outline-none hover:opacity-100 focus-visible:ring-[3px]">
          <X className="size-4" aria-hidden />
          <span className="sr-only">{closeLabel}</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
