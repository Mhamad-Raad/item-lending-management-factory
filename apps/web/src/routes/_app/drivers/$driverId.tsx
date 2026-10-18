import type { DriverDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, createFileRoute } from '@tanstack/react-router';
import { CalendarDays, Car, Pencil, Phone } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArchivedBadge } from '@/components/app/archived-badge';
import { DateText } from '@/components/app/date-text';
import { PageHeader } from '@/components/app/page-header';
import { PageSkeleton, QueryErrorState } from '@/components/app/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { driverQuery } from '@/features/drivers/api';
import { DriverDialog } from '@/features/drivers/driver-dialog';
import { RelatedOrders } from '@/features/orders/related-orders';
import { useDialogState } from '@/hooks/use-dialog-state';
import { usePageTitle } from '@/hooks/use-page-title';
import { useCan } from '@/lib/auth';
import { prefetch } from '@/lib/prefetch';
import { requirePermission } from '@/lib/route-guards';

export const Route = createFileRoute('/_app/drivers/$driverId')({
  beforeLoad: () => requirePermission('drivers.view'),
  loader: ({ context, params }) => prefetch(context.queryClient, driverQuery(Number(params.driverId))),
  component: DriverPage,
});

/** A driver's details, edited in the drivers' own dialog, and the orders they were given (§7.3.13, Q149). */
function DriverPage() {
  const { t } = useTranslation();
  const { driverId } = Route.useParams();
  const driver = useQuery(driverQuery(Number(driverId)));
  const canEdit = useCan('drivers.edit');
  const canViewOrders = useCan('orders.view');
  // The driver as it was when Edit was pressed: a refetch under the open dialog must not hand it a newer version,
  // or a change made meanwhile elsewhere would be overwritten instead of reported (§7.8).
  const [editing, setEditing] = useState<DriverDto | null>(null);
  const editor = useDialogState(editing);
  usePageTitle('drivers.detail.title');

  if (driver.isPending) return <PageSkeleton />;
  if (driver.isError) {
    return (
      <QueryErrorState
        error={driver.error}
        onRetry={() => void driver.refetch()}
        backLink={<Link to="/drivers">{t('drivers.detail.backToList')}</Link>}
      />
    );
  }

  const data = driver.data;
  const live = data.archivedAt === null;

  return (
    <>
      <PageHeader
        title={data.name}
        actions={
          canEdit && live ? (
            <Button variant="outline" onClick={() => setEditing(data)}>
              <Pencil aria-hidden />
              {t('common.actions.edit')}
            </Button>
          ) : null
        }
      />

      {live ? null : (
        <Alert>
          <AlertDescription className="flex items-center gap-2">
            <ArchivedBadge />
            {t('drivers.detail.archivedBanner')}
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent>
          {/* Numbers read left to right in every language (§7.11). */}
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('drivers.fields.phone')}</dt>
              <dd className="inline-flex items-center gap-1.5">
                <Phone className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span dir="ltr" className="tabular-nums">
                  {data.phone}
                </span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('drivers.fields.carNumber')}</dt>
              <dd className="inline-flex items-center gap-1.5">
                <Car className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <span dir="ltr">{data.carNumber}</span>
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-sm">{t('common.fields.createdAt')}</dt>
              <dd className="inline-flex items-center gap-1.5">
                <CalendarDays className="text-muted-foreground size-4 shrink-0" aria-hidden />
                <DateText value={data.createdAt} />
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {canViewOrders ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t('drivers.detail.orders')}</h2>
          {/* Keyed: another driver's page starts from their own default status and first page. */}
          <RelatedOrders
            key={data.id}
            filter={{ driverId: data.id }}
            label={t('drivers.detail.orders')}
            defaultStatus="ALL"
          />
        </section>
      ) : null}

      {editor.value ? (
        <DriverDialog
          key={editor.key}
          driver={editor.value}
          open={editor.open}
          onOpenChange={(next) => !next && setEditing(null)}
        />
      ) : null}
    </>
  );
}
