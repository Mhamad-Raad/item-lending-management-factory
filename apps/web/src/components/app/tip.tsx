import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * A label for a control drawn as an icon alone, shown above it on hover and on focus. The control keeps its
 * accessible name itself (`aria-label`); the tip is for eyes only. `AppShell` provides the tooltip context.
 */
export function Tip({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
