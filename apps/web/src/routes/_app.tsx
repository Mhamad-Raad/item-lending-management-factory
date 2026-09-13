import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { AnimatedOutlet } from '@/components/app/animated-outlet';
import { AppShell } from '@/components/app/app-shell';
import { logout } from '@/lib/auth';
import { requireAuthenticated } from '@/lib/route-guards';

export const Route = createFileRoute('/_app')({
  beforeLoad: () => requireAuthenticated(),
  component: AppLayout,
});

function AppLayout() {
  const navigate = useNavigate();

  return (
    <AppShell
      onLogout={async () => {
        await logout();
        await navigate({ to: '/login' });
      }}
    >
      <AnimatedOutlet />
    </AppShell>
  );
}
