import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  BusinessDate,
  formatTimestamp,
  PAGE_MAX,
  visibleAuditEntityTypes,
} from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { auditLogListQuery } from '@/features/history/api';
import { AuditSummary, AuditUser, EntityRef } from '@/features/history/audit-entry';
import { HistoryFilters } from '@/features/history/history-filters';
import { useListRoute } from '@/hooks/use-list-route';
import { usePageTitle } from '@/hooks/use-page-title';
import { authStore, useAuth } from '@/lib/auth';
import { requirePermission } from '@/lib/route-guards';

const SearchSchema = z.object({
  // An old or hand-edited link falls back to the unfiltered history instead of failing the page, as every list does.
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional().catch(undefined),
  userId: z.coerce.number().int().min(1).optional().catch(undefined),
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(PAGE_MAX).default(1).catch(1),
});

export const Route = createFileRoute('/_app/history')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('audit.view'),
  component: HistoryPage,
});

function HistoryPage() {
  const { t } = useTranslation();
  const search = Route.useSearch();
  const { setFilter, pageProps } = useListRoute(Route.fullPath, search);
  const [expanded, setExpanded] = useState<number | null>(null);
  const toggle = (id: number): void => setExpanded((open) => (open === id ? null : id));
  // The user filter lists users, which only an admin may read (§7.3.18).
  const isAdmin = useAuth().user?.role === 'ADMIN';
  usePageTitle('history.title');
  // The API shows only the history of what the reader may otherwise see (Q73): so does the filter, and a
  // link naming a type the reader may not see falls back to all.
  const entityTypes = visibleAuditEntityTypes((key) => authStore.can(key));
  const entityType = search.entityType && entityTypes.includes(search.entityType) ? search.entityType : undefined;

  // Typed back to front, a range is refused by the API; it is reported next to the dates instead.
  const rangeInvalid = Boolean(search.dateFrom && search.dateTo && search.dateFrom > search.dateTo);
  const params = {
    action: search.action,
    entityType,
    userId: isAdmin ? search.userId : undefined,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    page: search.page,
    pageSize: 50,
  };
  const logs = useQuery({ ...auditLogListQuery(params), enabled: !rangeInvalid });

  const activeFilters = [
    search.action,
    entityType,
    isAdmin ? search.userId : undefined,
    search.dateFrom ?? search.dateTo,
  ].filter(Boolean).length;

  return (
    <>
      <PageHeader title={t('history.title')} description={t('history.description')} />

      <HistoryFilters
        values={{ ...search, entityType }}
        entityTypes={entityTypes}
        isAdmin={isAdmin}
        activeCount={activeFilters}
        rangeInvalid={rangeInvalid}
        onChange={setFilter}
      />

      {rangeInvalid ? null : logs.isPending ? (
        <PageSkeleton />
      ) : logs.isError ? (
        <QueryErrorState error={logs.error} onRetry={() => void logs.refetch()} />
      ) : (
        <>
          {logs.data.items.length === 0 ? (
            <EmptyState title={t('history.empty')} />
          ) : (
            <>
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('history.columns.time')}</TableHead>
                      <TableHead>{t('history.columns.user')}</TableHead>
                      <TableHead>{t('history.columns.action')}</TableHead>
                      <TableHead>{t('history.columns.entity')}</TableHead>
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
                          <AuditUser row={row} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap">{t(`enums.auditAction.${row.action}`)}</TableCell>
                        <TableCell>
                          <EntityRef row={row} />
                        </TableCell>
                        <TableCell>
                          <AuditSummary row={row} expanded={expanded === row.id} onToggle={() => toggle(row.id)} />
                        </TableCell>
                        <TableCell className="text-muted-foreground" dir="ltr">
                          {row.ip ?? '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Below md a table of six columns scrolls sideways and hides the summary: one card per entry. */}
              <ul aria-label={t('history.title')} className="flex flex-col gap-3 md:hidden">
                {logs.data.items.map((row) => (
                  <li key={row.id} className="bg-card flex flex-col gap-2 rounded-lg border p-4">
                    <AuditSummary row={row} expanded={expanded === row.id} onToggle={() => toggle(row.id)} />
                    <div className="text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      <span dir="ltr">{formatTimestamp(row.createdAt)}</span>
                      <AuditUser row={row} />
                      <span>{t(`enums.auditAction.${row.action}`)}</span>
                      <EntityRef row={row} />
                      {row.ip ? <span dir="ltr">{row.ip}</span> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          <Pagination
            page={logs.data.page}
            pageSize={logs.data.pageSize}
            total={logs.data.total}
            onPageChange={pageProps.onPageChange}
          />
        </>
      )}
    </>
  );
}
