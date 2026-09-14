import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  BusinessDate,
  businessToday,
  formatTimestamp,
  type AuditAction,
  type AuditEntityType,
  type AuditLogDto,
  type PageDto,
} from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { dynamicKey } from '@/i18n/keys';
import { z } from 'zod';
import { DateRangePicker } from '@/components/app/date-picker';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { ListFilters } from '@/components/app/list-controls';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { translateSummaryParams } from '@/lib/audit-summary';
import { useAuth, useCan } from '@/lib/auth';
import { qk } from '@/lib/query-keys';
import { requirePermission } from '@/lib/route-guards';

const ALL = 'all';

const SearchSchema = z.object({
  // An old or hand-edited link falls back to the unfiltered history instead of failing the page, as every list does.
  action: z.enum(AUDIT_ACTIONS).optional().catch(undefined),
  entityType: z.enum(AUDIT_ENTITY_TYPES).optional().catch(undefined),
  userId: z.coerce.number().int().min(1).optional().catch(undefined),
  dateFrom: BusinessDate.optional().catch(undefined),
  dateTo: BusinessDate.optional().catch(undefined),
  page: z.coerce.number().int().min(1).default(1).catch(1),
});

export const Route = createFileRoute('/_app/history')({
  validateSearch: SearchSchema,
  beforeLoad: () => requirePermission('audit.view'),
  component: HistoryPage,
});

const LINK = 'text-primary underline-offset-4 hover:underline';

/** The record a row is about, linked only when the viewer may open its page (§7.3.18). */
/** The order a return or ledger row belongs to, read from its snapshot (§11.4). */
function owningOrderId(row: AuditLogDto): string | null {
  for (const snapshot of [row.after, row.before]) {
    if (snapshot && typeof snapshot === 'object' && 'orderId' in snapshot) {
      const { orderId } = snapshot as { orderId: unknown };
      if (typeof orderId === 'number' || typeof orderId === 'string') return String(orderId);
    }
  }
  return null;
}

function EntityRef({ row }: { row: AuditLogDto }) {
  const { t } = useTranslation();
  const isAdmin = useAuth().user?.role === 'ADMIN';
  const canViewItems = useCan('items.view');
  const canViewCustomers = useCan('customers.view');
  const canViewOrders = useCan('orders.view');
  const label = t(`enums.auditEntityType.${row.entityType}`);
  if (!row.entityId) return <>{label}</>;

  const id = row.entityId;
  const text = <span dir="ltr">#{id}</span>;
  const orderId =
    row.entityType === 'ORDER'
      ? id
      : row.entityType === 'RETURN' || row.entityType === 'LEDGER_ENTRY'
        ? owningOrderId(row)
        : null;
  // Drivers have no page of their own: they are edited in a dialog on their list.
  const target =
    row.entityType === 'ITEM' && canViewItems ? (
      <Link to="/items/$itemId" params={{ itemId: id }} className={LINK}>
        {text}
      </Link>
    ) : row.entityType === 'CUSTOMER' && canViewCustomers ? (
      <Link to="/customers/$customerId" params={{ customerId: id }} className={LINK}>
        {text}
      </Link>
    ) : row.entityType === 'USER' && isAdmin ? (
      <Link to="/users/$userId" params={{ userId: id }} className={LINK}>
        {text}
      </Link>
    ) : orderId && canViewOrders ? (
      <Link to="/orders/$orderId" params={{ orderId }} className={LINK}>
        {text}
      </Link>
    ) : (
      text
    );

  return (
    <span className="whitespace-nowrap">
      {label} {target}
    </span>
  );
}

/** Who did it; a failed sign-in has no user, only the name that was tried. */
function AuditUser({ row }: { row: AuditLogDto }) {
  return row.user ? (
    <bdi>{row.user.displayName}</bdi>
  ) : (
    <bdi className="text-muted-foreground italic">{row.usernameAttempt ?? '—'}</bdi>
  );
}

/** The entry's summary, which opens the before/after comparison below it. */
function AuditSummary({ row, expanded, onToggle }: { row: AuditLogDto; expanded: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-start gap-1">
      <button
        type="button"
        className="min-h-10 text-start underline-offset-4 hover:underline md:min-h-0"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {t(dynamicKey(row.summaryKey), translateSummaryParams(t, row.summaryParams))}
      </button>
      {expanded ? <AuditDiff row={row} /> : null}
    </div>
  );
}

function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  const [expanded, setExpanded] = useState<number | null>(null);
  const toggle = (id: number): void => setExpanded((open) => (open === id ? null : id));
  // The user filter lists users, which only an admin may read (§7.3.18).
  const isAdmin = useAuth().user?.role === 'ADMIN';
  usePageTitle('history.title');

  // Typed back to front, a range is refused by the API; it is reported next to the dates instead.
  const rangeInvalid = Boolean(search.dateFrom && search.dateTo && search.dateFrom > search.dateTo);
  const params = {
    action: search.action,
    entityType: search.entityType,
    userId: isAdmin ? search.userId : undefined,
    dateFrom: search.dateFrom,
    dateTo: search.dateTo,
    page: search.page,
    pageSize: 50,
  };
  const logs = useQuery({
    queryKey: qk.audit.list(params),
    queryFn: () => apiFetch<PageDto<AuditLogDto>>('/audit-logs', { query: params }),
    enabled: !rangeInvalid,
    // The filters stay put while new rows load: no skeleton, no lost focus.
    placeholderData: keepPreviousData,
  });

  const activeFilters = [
    search.action,
    search.entityType,
    isAdmin ? search.userId : undefined,
    search.dateFrom ?? search.dateTo,
  ].filter(Boolean).length;
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  return (
    <>
      <PageHeader title={t('history.title')} description={t('history.description')} />

      <ListFilters
        activeCount={activeFilters}
        onClear={() =>
          setFilter({
            action: undefined,
            entityType: undefined,
            userId: undefined,
            dateFrom: undefined,
            dateTo: undefined,
          })
        }
        error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
      >
        <Select
          value={search.action ?? ALL}
          onValueChange={(value) => setFilter({ action: value === ALL ? undefined : (value as AuditAction) })}
        >
          <SelectTrigger className="w-full md:w-56" aria-label={t('history.filters.action')}>
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
          onValueChange={(value) => setFilter({ entityType: value === ALL ? undefined : (value as AuditEntityType) })}
        >
          <SelectTrigger className="w-full md:w-56" aria-label={t('history.filters.entityType')}>
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

        {isAdmin ? (
          <div className="w-full md:w-64">
            <EntityCombobox
              kind="user"
              aria-label={t('history.columns.user')}
              value={search.userId ?? null}
              onChange={(userId) => setFilter({ userId: userId ?? undefined })}
              placeholder={t('history.filters.allUsers')}
            />
          </div>
        ) : null}
        {isAdmin && search.userId ? (
          <Button variant="ghost" onClick={() => setFilter({ userId: undefined })}>
            {t('history.filters.clearUser')}
          </Button>
        ) : null}
        <DateRangePicker
          idPrefix="history-date"
          from={search.dateFrom}
          to={search.dateTo}
          max={businessToday()}
          onChange={({ from, to }) => setFilter({ dateFrom: from, dateTo: to })}
          error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
        />
      </ListFilters>

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
            onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
          />
        </>
      )}
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
            <pre className="overflow-x-auto whitespace-pre-wrap">
              <bdi dir="ltr">{JSON.stringify(before[key] ?? null)}</bdi>
            </pre>
            <pre className="overflow-x-auto whitespace-pre-wrap">
              <bdi dir="ltr">{JSON.stringify(after[key] ?? null)}</bdi>
            </pre>
          </div>
        );
      })}
    </div>
  );
}
