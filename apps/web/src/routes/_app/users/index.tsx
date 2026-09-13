import { ROLES, type PageDto, type Role, type UserListItemDto } from '@pallet/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { CircleCheck, CircleSlash, Plus, Users } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateText } from '@/components/app/date-text';
import { ListEmpty, ListFilters, SearchBox } from '@/components/app/list-controls';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { usePageTitle } from '@/hooks/use-page-title';
import { useSearchInput } from '@/hooks/use-search-input';
import { apiFetch } from '@/lib/api-client';
import { listSearch, sortSearch } from '@/lib/list-search';
import { qk } from '@/lib/query-keys';
import { requireAdmin } from '@/lib/route-guards';

const ALL = 'all';
const STATES = ['true', 'false'] as const;

const SearchSchema = z.object({
  ...listSearch,
  role: z.enum(ROLES).optional().catch(undefined),
  isActive: z.enum(STATES).optional().catch(undefined),
  sort: sortSearch(['username', 'displayName', 'createdAt', 'lastLoginAt']),
});

export const Route = createFileRoute('/_app/users/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requireAdmin(),
  component: UsersPage,
});

/** §7.3.19: every column the list shows; the username opens the user. */
const COLUMNS: DataColumn<UserListItemDto>[] = [
  { id: 'username', header: 'users.fields.username', cell: (user) => user.username, sortKey: 'username' },
  {
    id: 'displayName',
    header: 'users.fields.displayName',
    cell: (user) => user.displayName,
    sortKey: 'displayName',
    mobile: 'subtitle',
  },
  { id: 'role', header: 'users.fields.role', cell: (user) => <RoleText role={user.role} /> },
  { id: 'status', header: 'users.fields.status', cell: (user) => <ActiveBadge active={user.isActive} /> },
  {
    id: 'lastLogin',
    header: 'users.fields.lastLogin',
    cell: (user) => (user.lastLoginAt ? <DateText value={user.lastLoginAt} withTime /> : '—'),
    sortKey: 'lastLoginAt',
  },
];

function RoleText({ role }: { role: Role }) {
  const { t } = useTranslation();
  return <>{t(`enums.role.${role}`)}</>;
}

/** Active or not, said with an icon as well as a colour (§7.15). */
function ActiveBadge({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const Icon = active ? CircleCheck : CircleSlash;
  return (
    <Badge variant={active ? 'success' : 'secondary'}>
      <Icon aria-hidden />
      {t(active ? 'users.status.active' : 'users.status.inactive')}
    </Badge>
  );
}

function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate({ from: Route.fullPath });
  const search = Route.useSearch();
  usePageTitle('users.list.title');

  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ search: (prev) => ({ ...prev, q, page: 1 }), replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  const setFilter = (patch: Partial<typeof search>): void =>
    void navigate({ search: (prev) => ({ ...prev, ...patch, page: 1 }), replace: true });

  const params = {
    q: search.q,
    role: search.role,
    isActive: search.isActive,
    sort: search.sort,
    page: search.page,
    pageSize: search.pageSize,
  };
  const users = useQuery({
    queryKey: qk.users.list(params),
    queryFn: () => apiFetch<PageDto<UserListItemDto>>('/users', { query: params }),
    placeholderData: keepPreviousData,
  });

  if (users.isPending) return <PageSkeleton />;
  if (users.isError) return <QueryErrorState error={users.error} onRetry={() => void users.refetch()} />;

  const newUser = (
    <Button asChild>
      <Link to="/users/new">
        <Plus aria-hidden />
        {t('users.list.new')}
      </Link>
    </Button>
  );
  const activeFilters = [search.role, search.isActive].filter(Boolean).length;

  return (
    <>
      <PageHeader title={t('users.list.title')} actions={newUser} />
      <DataTable
        label={t('users.list.title')}
        columns={COLUMNS}
        rows={users.data.items}
        rowKey={(user) => user.id}
        rowLink={(user, children) => (
          <Link
            to="/users/$userId"
            params={{ userId: String(user.id) }}
            className="text-primary underline-offset-4 hover:underline"
          >
            {children}
          </Link>
        )}
        total={users.data.total}
        page={users.data.page}
        pageSize={users.data.pageSize}
        sort={search.sort}
        defaultSort="username"
        onSortChange={(sort) => setFilter({ sort })}
        onPageChange={(page) => void navigate({ search: (prev) => ({ ...prev, page }) })}
        onPageSizeChange={(pageSize) => setFilter({ pageSize })}
        isFetching={users.isFetching}
        toolbar={
          <ListFilters
            search={<SearchBox value={term} onChange={setTerm} />}
            activeCount={activeFilters}
            onClear={() => setFilter({ role: undefined, isActive: undefined })}
          >
            <Select
              value={search.role ?? ALL}
              onValueChange={(value) => setFilter({ role: value === ALL ? undefined : (value as Role) })}
            >
              <SelectTrigger className="w-full md:w-44" aria-label={t('users.fields.role')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('users.list.anyRole')}</SelectItem>
                {ROLES.map((role) => (
                  <SelectItem key={role} value={role}>
                    {t(`enums.role.${role}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={search.isActive ?? ALL}
              onValueChange={(value) =>
                setFilter({ isActive: value === ALL ? undefined : (value as (typeof STATES)[number]) })
              }
            >
              <SelectTrigger className="w-full md:w-44" aria-label={t('users.fields.status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t('users.list.anyStatus')}</SelectItem>
                <SelectItem value="true">{t('users.status.active')}</SelectItem>
                <SelectItem value="false">{t('users.status.inactive')}</SelectItem>
              </SelectContent>
            </Select>
          </ListFilters>
        }
        empty={
          <ListEmpty
            filtered={Boolean(search.q) || activeFilters > 0}
            onClearFilters={() => void navigate({ search: {}, replace: true })}
            icon={Users}
            title={t('users.list.empty')}
            action={newUser}
          />
        }
      />
    </>
  );
}
