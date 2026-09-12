import { formatTimestamp, type PageDto, type UserListItemDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { PageHeader } from '@/components/app/page-header';
import { Pagination } from '@/components/app/pagination';
import { EmptyState, PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useSearchInput } from '@/hooks/use-search-input';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { qk } from '@/lib/query-keys';
import { requireAdmin } from '@/lib/route-guards';

const SearchSchema = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const Route = createFileRoute('/_app/users/')({
  validateSearch: SearchSchema,
  beforeLoad: () => requireAdmin(),
  component: UsersPage,
});

function UsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const commitSearch = useCallback(
    (q: string | undefined) => void navigate({ to: '/users', search: { q, page: 1 }, replace: true }),
    [navigate],
  );
  const [term, setTerm] = useSearchInput(search.q, commitSearch);
  usePageTitle('users.list.title');

  const params = { q: search.q, page: search.page };
  const users = useQuery({
    queryKey: qk.users.list(params),
    queryFn: () => apiFetch<PageDto<UserListItemDto>>('/users', { query: params }),
  });

  if (users.isPending) return <PageSkeleton />;
  if (users.isError) return <QueryErrorState error={users.error} onRetry={() => void users.refetch()} />;

  return (
    <>
      <PageHeader
        title={t('users.list.title')}
        actions={
          <Button asChild>
            <Link to="/users/new">
              <Plus aria-hidden />
              {t('users.list.new')}
            </Link>
          </Button>
        }
      />

      <Input
        aria-label={t('common.search')}
        placeholder={t('common.search')}
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        className="max-w-xs"
      />

      {users.data.items.length === 0 ? (
        <EmptyState title={t('users.list.empty')} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('users.fields.username')}</TableHead>
              <TableHead>{t('users.fields.displayName')}</TableHead>
              <TableHead>{t('users.fields.role')}</TableHead>
              <TableHead>{t('users.fields.status')}</TableHead>
              <TableHead>{t('users.fields.lastLogin')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.data.items.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/users/$userId"
                    params={{ userId: String(user.id) }}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {user.username}
                  </Link>
                </TableCell>
                <TableCell>{user.displayName}</TableCell>
                <TableCell>{t(`enums.role.${user.role}`)}</TableCell>
                <TableCell>
                  <Badge variant={user.isActive ? 'success' : 'secondary'}>
                    {t(user.isActive ? 'users.status.active' : 'users.status.inactive')}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground" dir="ltr">
                  {user.lastLoginAt ? formatTimestamp(user.lastLoginAt) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Pagination
        page={users.data.page}
        pageSize={users.data.pageSize}
        total={users.data.total}
        onPageChange={(page) => void navigate({ to: '/users', search: (prev) => ({ ...prev, page }) })}
      />
    </>
  );
}
