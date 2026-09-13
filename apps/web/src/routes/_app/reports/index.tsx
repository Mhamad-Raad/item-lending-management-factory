import { createFileRoute, redirect } from '@tanstack/react-router';
import { allowedReports } from '@/features/reports/report-list';
import { requireAnyPermission } from '@/lib/route-guards';

/** `/reports` opens the first report the user may view (§7.2). */
export const Route = createFileRoute('/_app/reports/')({
  beforeLoad: () => {
    requireAnyPermission('reports.viewPositions', 'reports.viewPurchases', 'reports.viewActivity', 'reports.viewStock');
    const [first] = allowedReports();
    if (first) throw redirect({ to: first.to, replace: true });
  },
});
