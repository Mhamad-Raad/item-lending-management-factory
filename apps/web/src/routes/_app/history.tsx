import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  formatTimestamp,
  type AuditAction,
  type AuditEntityType,
  type AuditLogDto,
  type PageDto,
} from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { translateSummaryParams } from '@/lib/audit-summary';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const ALL = 'all';

const SearchSchema = z.object({
  action: z.enum(AUDIT_ACTIONS).optional(),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute('/_app/history')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('audit.view'),
  component: HistoryPage,
});

function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const [expanded, setExpanded] = useState<number | null>(null);
  usePageTitle('history.title');

  const params = { action: search.action, entityType: search.entityType, page: search.page, pageSize: 50 };
  const logs = useQuery({
    queryKey: qk.audit.list(params),
    queryFn: () => apiFetch<PageDto<AuditLogDto>>('/audit-logs', { query: params }),
  });

  const setFilter = (patch: Record<string, string | undefined>): void => {
    void navigate({ to: '/history', search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });
  };

  if (logs.isPending) return <PageSkeleton />;
  if (logs.isError) return <QueryErrorState error={logs.error} onRetry={() => void logs.refetch()} />;

  return (
    <>
      <PageHeader title={t('history.title')} description={t('history.description')} />

      <div className="flex flex-wrap gap-3">
        <Select
          value={search.action ?? ALL}
          onValueChange={(value) => setFilter({ action: value === ALL ? undefined : value })}
        >
          <SelectTrigger className="w-56" aria-label={t('history.filters.action')}>
            <SelectValue placeholder={t('history.filters.action')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('history.filters.allActions')}</SelectItem>
            {AUDIT_ACTIONS.map((action: AuditAction) => (
              <SelectItem key={action} value={action}>
                {t(`enums.auditAction.${action}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={search.entityType ?? ALL}
          onValueChange={(value) => setFilter({ entityType: value === ALL ? undefined : value })}
        >
          <SelectTrigger className="w-56" aria-label={t('history.filters.entityType')}>
            <SelectValue placeholder={t('history.filters.entityType')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('history.filters.allEntities')}</SelectItem>
            {AUDIT_ENTITY_TYPES.map((entity: AuditEntityType) => (
              <SelectItem key={entity} value={entity}>
                {t(`enums.auditEntityType.${entity}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {logs.data.items.length === 0 ? (
        <EmptyState title={t('history.empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('history.columns.time')}</TableHead>
              <TableHead>{t('history.columns.user')}</TableHead>
              <TableHead>{t('history.columns.summary')}</TableHead>
              <TableHead>{t('history.columns.ip')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.data.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap" dir="ltr">
                  {formatTimestamp(row.createdAt)}
                </TableCell>
                <TableCell>
                  {row.user ? (
                    row.user.displayName
                  ) : (
                    <span className="text-muted-foreground italic">{row.usernameAttempt ?? '—'}</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1">
                    <button
                      type="button"
                      className="text-start underline-offset-4 hover:underline"
                      aria-expanded={expanded === row.id}
                      onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    >
                      {t(row.summaryKey, translateSummaryParams(t, row.summaryParams))}
                    </button>
                    {expanded === row.id ? <AuditDiff row={row} /> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground" dir="ltr">
                  {row.ip ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        page={logs.data.page}
        pageSize={logs.data.pageSize}
        total={logs.data.total}
        onPageChange={(page) => void navigate({ to: '/history', search: (prev) => ({ ...prev, page }) })}
      />
    </>
  );
}

/** Before and after, side by side; the server has already removed anything the viewer may not see. */
function AuditDiff({ row }: { row: AuditLogDto }) {
  const { t } = useTranslation();
  const before = (row.before ?? {}) as Record<string, unknown>;
  const after = (row.after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  if (keys.length === 0) return null;

  return (
    <div className="bg-muted/40 grid grid-cols-[auto_1fr_1fr] gap-x-4 gap-y-1 rounded-md p-3 text-xs">
      <span className="font-medium">{t('history.diff.field')}</span>
      <span className="font-medium">{t('history.diff.before')}</span>
      <span className="font-medium">{t('history.diff.after')}</span>
      {keys.map((key) => {
        const changed = JSON.stringify(before[key]) !== JSON.stringify(after[key]);
        return (
          <div key={key} className="contents">
            <span className={changed ? 'font-medium' : 'text-muted-foreground'}>
              {changed ? '• ' : ''}
              {key}
            </span>
            <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(before[key] ?? null)}</pre>
            <pre className="overflow-x-auto whitespace-pre-wrap">{JSON.stringify(after[key] ?? null)}</pre>
          </div>
        );
      })}
    </div>
  );
}
