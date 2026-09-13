import { formatTimestamp, type SettingsDto } from '@pallet/shared';
import { useQuery } from '@tanstack/react-query';
import { Link, useRouterState } from '@tanstack/react-router';
import { Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/components/app/page-header';
import { Button } from '@/components/ui/button';
import { usePageTitle } from '@/hooks/use-page-title';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { allowedReports, type ReportKey } from './report-list';
import { qk } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

/**
 * The frame every report shares (§7.3.17, §12.1): the tab strip of the reports the user may view, the
 * filters, a Print button, and — on paper only — a header naming the factory, the report, its filters
 * and when it was generated.
 */
export function ReportFrame({
  report,
  filters,
  printedFilters = [],
  generatedAt,
  landscape = false,
  children,
}: {
  report: ReportKey;
  filters?: React.ReactNode;
  /** The applied filters, each already worded, printed on one line above the tables. */
  printedFilters?: readonly string[];
  generatedAt?: string;
  landscape?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  // Re-renders the tabs when permissions change.
  useAuth();
  const titleKey = `reports.${report}.title` as const;
  usePageTitle(titleKey);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const settings = useQuery({
    queryKey: qk.settings(),
    queryFn: () => apiFetch<SettingsDto>('/settings'),
    staleTime: 5 * 60_000,
  });

  return (
    <div className={cn('flex flex-col gap-4', landscape && 'print-landscape')}>
      <div data-print="only" className="hidden flex-col gap-1 text-sm">
        <span className="font-semibold">
          <bdi>{settings.data?.factoryName ?? t('common.appName')}</bdi>
        </span>
        <span className="text-lg font-semibold">{t(titleKey)}</span>
        {printedFilters.length > 0 ? (
          <span>{t('reports.printedFilters', { filters: printedFilters.join(' · ') })}</span>
        ) : null}
        {generatedAt ? <GeneratedAt at={formatTimestamp(generatedAt)} /> : null}
      </div>

      <div data-print="hide" className="flex flex-col gap-4">
        <PageHeader
          title={t(titleKey)}
          actions={
            <Button variant="outline" onClick={() => window.print()}>
              <Printer aria-hidden />
              {t('reports.print')}
            </Button>
          }
        />
        <nav aria-label={t('reports.tabs')} className="bg-muted flex max-w-full gap-1 overflow-x-auto rounded-lg p-1">
          {allowedReports().map((tab) => (
            <Link
              key={tab.key}
              to={tab.to}
              aria-current={pathname === tab.to ? 'page' : undefined}
              className={cn(
                'focus-visible:ring-ring flex h-10 shrink-0 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none md:h-8',
                pathname === tab.to
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`reports.${tab.key}.title`)}
            </Link>
          ))}
        </nav>
        {filters ? <div className="flex flex-wrap items-end gap-3">{filters}</div> : null}
      </div>

      {children}
    </div>
  );
}

/** "Generated …" in the page's direction, with only the timestamp itself running left to right. */
function GeneratedAt({ at }: { at: string }) {
  const { t } = useTranslation();
  const MARK = '\u0000';
  const [before = '', after = ''] = t('reports.generatedAt', { at: MARK }).split(MARK);
  return (
    <span>
      {before}
      <span dir="ltr">{at}</span>
      {after}
    </span>
  );
}
