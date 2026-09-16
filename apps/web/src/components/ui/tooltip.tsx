import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

// shadcn/ui tooltip (new-york). RTL-audited: a caller that wants the tip at the reading end derives its
// `side` from the direction (the collapsed sidebar); everything else keeps Radix's default `top`.
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export function TooltipContent({
  className,
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          'bg-foreground text-background z-50 rounded-md px-3 py-1.5 text-xs font-medium shadow-md',
          'animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 duration-150',
          className,
        )}
        {...props}
      />
    </TooltipPrimitive.Portal>
  );
}
