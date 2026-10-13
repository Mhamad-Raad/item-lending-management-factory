import { createFileRoute } from '@tanstack/react-router';
import { AnimatedOutlet } from '@/components/app/animated-outlet';
import { AppShell } from '@/components/app/app-shell';
import { ReceiptPrinter } from '@/features/receipt/receipt-printer';
import { useSignOut } from '@/hooks/use-sign-out';
import { requireAuthenticated } from '@/lib/route-guards';

export const Route = createFileRoute('/_app')({
  beforeLoad: () => requireAuthenticated(),
  component: AppLayout,
});

function AppLayout() {
  const signOut = useSignOut();

  return (
    <AppShell onLogout={() => void signOut()}>
      <AnimatedOutlet />
      {/* The receipts the app's buttons print, in place (Q140). */}
      <ReceiptPrinter />
    </AppShell>
  );
}
