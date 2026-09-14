import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground border-transparent',
        secondary: 'bg-secondary text-secondary-foreground border-transparent',
        outline: 'text-foreground',
        // Q44: at 12 % the light success tint leaves its text at 4.4 : 1; at 8 % it reads at 4.5 or more.
        success: 'bg-success/8 text-success border-success/30 dark:bg-success/20',
        info: 'bg-info/12 text-info border-info/30 dark:bg-info/20',
        warning: 'bg-warning/12 text-warning border-warning/30 dark:bg-warning/20',
        destructive: 'bg-destructive/10 text-destructive border-destructive/30',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
