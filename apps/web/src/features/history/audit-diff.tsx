import type { AuditLogDto } from '@pallet/shared';
import { useTranslation } from 'react-i18next';

/** Before and after, side by side; the server has already removed anything the viewer may not see. */
export function AuditDiff({ row }: { row: AuditLogDto }) {
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
