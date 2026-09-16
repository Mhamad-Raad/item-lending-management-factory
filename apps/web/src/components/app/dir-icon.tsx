import {
  ArrowLeft as ArrowLeftIcon,
  ArrowRight as ArrowRightIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  ChevronsLeft as ChevronsLeftIcon,
  ChevronsRight as ChevronsRightIcon,
  CornerDownLeft as CornerDownLeftIcon,
  CornerDownRight as CornerDownRightIcon,
  LogIn as LogInIcon,
  LogOut as LogOutIcon,
  PanelLeftClose as PanelLeftCloseIcon,
  PanelLeftOpen as PanelLeftOpenIcon,
  Redo2 as Redo2Icon,
  Undo2 as Undo2Icon,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';
import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Icons that point a way (§7.11), mirrored right to left so "back", "undo" and "sign out" point where
 * Kurdish and Arabic readers expect. Import these instead of the lucide originals; a test enforces it.
 */
function dirIcon(Icon: LucideIcon): LucideIcon {
  const Mirrored = forwardRef<SVGSVGElement, LucideProps>(({ className, ...props }, ref) => (
    <Icon ref={ref} className={cn('rtl:-scale-x-100', className)} {...props} />
  ));
  Mirrored.displayName = Icon.displayName;
  return Mirrored;
}

export const ArrowLeft = dirIcon(ArrowLeftIcon);
export const ArrowRight = dirIcon(ArrowRightIcon);
export const ChevronLeft = dirIcon(ChevronLeftIcon);
export const ChevronRight = dirIcon(ChevronRightIcon);
export const ChevronsLeft = dirIcon(ChevronsLeftIcon);
export const ChevronsRight = dirIcon(ChevronsRightIcon);
export const CornerDownLeft = dirIcon(CornerDownLeftIcon);
export const CornerDownRight = dirIcon(CornerDownRightIcon);
export const LogIn = dirIcon(LogInIcon);
export const LogOut = dirIcon(LogOutIcon);
export const PanelLeftClose = dirIcon(PanelLeftCloseIcon);
export const PanelLeftOpen = dirIcon(PanelLeftOpenIcon);
export const Redo2 = dirIcon(Redo2Icon);
export const Undo2 = dirIcon(Undo2Icon);
