import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';

export function LowStockBadge() {
  const { t } = useTranslation();
  return (
    <Badge variant="warning">
      <TriangleAlert aria-hidden />
      {t('items.lowStock')}
    </Badge>
  );
}
