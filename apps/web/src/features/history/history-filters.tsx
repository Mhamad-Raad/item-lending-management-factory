import { AUDIT_ACTIONS, businessToday, type AuditAction, type AuditEntityType } from '@pallet/shared';
import { useTranslation } from 'react-i18next';
import { DateRangePicker } from '@/components/app/date-picker';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { ListFilters } from '@/components/app/list-controls';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const ALL = 'all';

/** What the history can be filtered on (§7.3.18), as the URL holds it. */
export interface HistoryFilterValues {
  action?: AuditAction;
  entityType?: AuditEntityType;
  userId?: number;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * The history's filters: action, record type (only the types the viewer may see, Q73), user (admins
 * only: the list of users is theirs to read) and a date range reported invalid beside the dates.
 */
export function HistoryFilters({
  values,
  entityTypes,
  isAdmin,
  activeCount,
  rangeInvalid,
  onChange,
}: {
  values: HistoryFilterValues;
  entityTypes: readonly AuditEntityType[];
  isAdmin: boolean;
  activeCount: number;
  rangeInvalid: boolean;
  onChange: (patch: Partial<HistoryFilterValues>) => void;
}) {
  const { t } = useTranslation();
  return (
    <ListFilters
      activeCount={activeCount}
      onClear={() =>
        onChange({
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
        value={values.action ?? ALL}
        onValueChange={(value) => onChange({ action: value === ALL ? undefined : (value as AuditAction) })}
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
        value={values.entityType ?? ALL}
        onValueChange={(value) => onChange({ entityType: value === ALL ? undefined : (value as AuditEntityType) })}
      >
        <SelectTrigger className="w-full md:w-56" aria-label={t('history.filters.entityType')}>
          <SelectValue placeholder={t('history.filters.entityType')} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t('history.filters.allEntities')}</SelectItem>
          {entityTypes.map((entity: AuditEntityType) => (
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
            value={values.userId ?? null}
            onChange={(userId) => onChange({ userId: userId ?? undefined })}
            placeholder={t('history.filters.allUsers')}
          />
        </div>
      ) : null}
      {isAdmin && values.userId ? (
        <Button variant="ghost" onClick={() => onChange({ userId: undefined })}>
          {t('history.filters.clearUser')}
        </Button>
      ) : null}
      <DateRangePicker
        idPrefix="history-date"
        from={values.dateFrom}
        to={values.dateTo}
        max={businessToday()}
        onChange={({ from, to }) => onChange({ dateFrom: from, dateTo: to })}
        error={rangeInvalid ? t('errors.DATE_RANGE_INVALID') : undefined}
      />
    </ListFilters>
  );
}
