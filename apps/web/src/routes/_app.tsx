import { Outlet, createFileRoute, useNavigate } from '@tanstack/react-router';
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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 md:p-6">
        <Outlet />
      </div>
    </AppShell>
  );
}
