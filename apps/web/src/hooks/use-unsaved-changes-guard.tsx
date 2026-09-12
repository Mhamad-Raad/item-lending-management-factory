import { useBlocker } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ConfirmDialog } from '@/components/app/confirm-dialog';

/**
 * Asks before leaving a form with unsaved changes (§7.9): in-app navigation gets the confirm dialog,
 * closing the tab the browser's own prompt. A form calls `allowLeave` just before the navigation a
 * successful save makes, which must not ask.
 */
export function useUnsavedChangesGuard(isDirty: boolean): { allowLeave: () => void; dialog: React.ReactNode } {
  const { t } = useTranslation();
  const dirty = useRef(isDirty);
  const leaving = useRef(false);

  useEffect(() => {
    dirty.current = isDirty;
  }, [isDirty]);

  const shouldBlock = (): boolean => dirty.current && !leaving.current;
  const blocker = useBlocker({ shouldBlockFn: shouldBlock, enableBeforeUnload: shouldBlock, withResolver: true });

  return {
    allowLeave: () => {
      leaving.current = true;
    },
    dialog: (
      <ConfirmDialog
        open={blocker.status === 'blocked'}
        onOpenChange={(open) => {
          if (!open) blocker.reset?.();
        }}
        title={t('common.unsavedChanges.title')}
        description={t('common.unsavedChanges.body')}
        confirmLabel={t('common.unsavedChanges.leave')}
        onConfirm={() => blocker.proceed?.()}
      />
    ),
  };
}
