import { Tabs as TabsPrimitive } from 'radix-ui';
import { isRtl, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

// shadcn/ui tabs (new-york). RTL-audited: the list starts at inline-start, triggers use `gap`, and the
// reading direction is passed down so the arrow keys move the right way in Kurdish and Arabic.
export function Tabs({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const { language } = usePreferences();
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      dir={isRtl(language) ? 'rtl' : 'ltr'}
      className={cn('flex flex-col gap-4', className)}
      {...props}
    />
  );
}

export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-muted text-muted-foreground inline-flex h-12 w-fit max-w-full items-center justify-start overflow-x-auto rounded-lg p-1',
        className,
      )}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        'inline-flex h-full items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors outline-none',
        'data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
}

export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        'focus-visible:ring-ring focus-visible:ring-offset-background flex flex-col gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
        className,
      )}
      {...props}
    />
  );
}
