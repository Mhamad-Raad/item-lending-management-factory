import type { PermissionKey } from '@pallet/shared';
import { authStore } from '@/lib/auth-store';

/** The four reports in tab order, each behind its permission (§7.2, §7.3.17). */
export const REPORTS = [
  { to: '/reports/positions', key: 'positions', permission: 'reports.viewPositions' },
  { to: '/reports/purchases', key: 'purchases', permission: 'reports.viewPurchases' },
  { to: '/reports/activity', key: 'activity', permission: 'reports.viewActivity' },
  { to: '/reports/stock', key: 'stock', permission: 'reports.viewStock' },
] as const satisfies readonly { to: string; key: string; permission: PermissionKey }[];

export type ReportKey = (typeof REPORTS)[number]['key'];

export function allowedReports() {
  return REPORTS.filter((report) => authStore.can(report.permission));
}
