import { Loader2, Printer, type LucideIcon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { printRequest, usePrintPreparing, type JobRequest } from './print-receipt';

/**
 * A print button (Q140): presses `request`, and while that receipt is being prepared shows a spinner in place of its
 * icon (Q180), so the press is seen to be taken where it was made. It stays pressable: pressing again shares what is
 * on its way. One request for both, so the button prints the receipt its spinner watches.
 */
export function PrintButton({
  request,
  icon: Icon = Printer,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'onClick' | 'children'> & {
  request: JobRequest;
  icon?: LucideIcon;
  children?: ReactNode;
}) {
  const preparing = usePrintPreparing(request);
  return (
    <Button {...props} onClick={() => printRequest(request)}>
      {preparing ? <Loader2 className="animate-spin" aria-hidden /> : <Icon aria-hidden />}
      {children}
    </Button>
  );
}
