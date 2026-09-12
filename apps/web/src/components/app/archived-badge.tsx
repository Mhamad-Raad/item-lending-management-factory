import { Archive } from 'lucide-react';
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
