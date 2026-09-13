import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

// shadcn/ui button (new-york). RTL-audited: no physical left/right classes; icon spacing uses gap.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap duration-150 outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow-xs hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground shadow-xs hover:bg-destructive/90',
        outline: 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2 has-[>svg]:px-3 md:h-9',
        sm: 'h-10 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5 md:h-9',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-10 md:size-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

/**
 * A press shrinks the button to 98 % (§7.14) through CSS `:active`, on a button of its own and on the element
 * it wraps with `asChild` alike. motion's `whileTap` is not used (Q45): on Enter it emulates a pointer press,
 * and a Radix trigger toggled by both closes the menu it just opened.
 */
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      data-slot="button"
      className={cn(
        buttonVariants({ variant, size }),
        'transition-[color,background-color,border-color,scale] active:scale-[0.98]',
        className,
      )}
      {...props}
    />
  );
}
