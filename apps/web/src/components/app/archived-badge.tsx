import { Archive, CircleCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

/** Icon and text: colour is never the only sign (§7.15). */
export function ArchivedBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="secondary">
      <Archive aria-hidden />
      {t('common.archived')}
    </Badge>
  );
}

/** A record's state in a list's status column: active or archived, both said in words (Q144). */
export function RecordStatusBadge({ archived }: { archived: boolean }) {
  const { t } = useTranslation();
  return archived ? (
    <ArchivedBadge />
  ) : (
    <Badge variant="success">
      <CircleCheck aria-hidden />
      {t('common.active')}
    </Badge>
  );
}
