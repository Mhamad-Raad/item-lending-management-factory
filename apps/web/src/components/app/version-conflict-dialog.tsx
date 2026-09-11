import { useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { versionConflictStore } from '@/lib/version-conflict';

/** Mounted once at the root; opened by `handleApiError` whenever the server reports a conflict. */
export function VersionConflictDialog() {
  const { t } = useTranslation();
  const conflict = useSyncExternalStore(versionConflictStore.subscribe, versionConflictStore.getSnapshot, () => null);

  return (
    <Dialog open={conflict !== null} onOpenChange={(open) => !open && versionConflictStore.close()}>
      <DialogContent closeLabel={t('common.actions.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('common.versionConflict.title')}</DialogTitle>
          <DialogDescription>{t('common.versionConflict.body')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => versionConflictStore.close()}>
            {t('common.versionConflict.keepEditing')}
          </Button>
          <Button
            onClick={() => {
              conflict?.onReload();
              versionConflictStore.close();
            }}
          >
            {t('common.versionConflict.reload')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
