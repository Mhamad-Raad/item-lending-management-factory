import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { logout } from '@/lib/auth';

/**
 * Signs out and goes to the login page, whatever the server said. This device forgets the session
 * either way; when the server could not be told, a toast says so (Q80).
 */
export function useSignOut(): () => Promise<void> {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return useCallback(async () => {
    try {
      await logout();
    } catch {
      toast.error(t('auth.logoutFailed'));
    }
    await navigate({ to: '/login' });
  }, [navigate, t]);
}
