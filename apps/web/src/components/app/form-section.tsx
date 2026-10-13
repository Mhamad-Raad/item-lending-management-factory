import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TONE_CHIP, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

/** A titled part of a form: an icon chip in its tone, a heading, one line on what it holds (Q145). */
export function FormSection({
  icon: Icon,
  tone = 'primary',
  title,
  hint,
  children,
}: {
  icon: LucideIcon;
  tone?: Tone;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', TONE_CHIP[tone])}>
            <Icon className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-muted-foreground text-sm">{hint}</p>
          </div>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}
