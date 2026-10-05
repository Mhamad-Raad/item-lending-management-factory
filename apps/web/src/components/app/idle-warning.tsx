import { useState } from 'react';
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
import { answerWarning, useIdleSecondsLeft } from '@/lib/idle';

/**
 * The last minute before an idle session is ended (Q136): says so, counts down, and takes any answer — the
 * button, a key, a press anywhere — as the user being there. Mounted once, above every page.
 */
export function IdleWarning() {
  const { t } = useTranslation();
  const secondsLeft = useIdleSecondsLeft();
  // The figure stays while the dialog fades out, instead of dropping to nothing.
  const [shown, setShown] = useState(secondsLeft ?? 0);
  if (secondsLeft !== null && secondsLeft !== shown) setShown(secondsLeft);

  return (
    <Dialog open={secondsLeft !== null} onOpenChange={(open) => !open && answerWarning()}>
      <DialogContent closeLabel={t('common.actions.close')} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('auth.idle.title')}</DialogTitle>
          <DialogDescription>{t('auth.idle.body', { seconds: shown })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={answerWarning}>{t('auth.idle.stay')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
