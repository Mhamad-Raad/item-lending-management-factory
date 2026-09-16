import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/**
 * A password field with a reveal toggle. The toggle is a real button so it is reachable by
 * keyboard, and it never submits the form.
 */
export function PasswordInput({ className, ...props }: React.ComponentProps<typeof Input>) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <Input {...props} type={visible ? 'text' : 'password'} className={`pe-13 ${className ?? ''}`} />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="absolute end-0 top-0 size-13 text-muted-foreground md:size-13"
        aria-label={t(visible ? 'common.password.hide' : 'common.password.show')}
        aria-pressed={visible}
        onClick={() => setVisible((shown) => !shown)}
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </Button>
    </div>
  );
}
