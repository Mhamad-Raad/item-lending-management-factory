import { Link, type LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { TONE_BAR, TONE_CHIP, type Tone } from '@/lib/tones';
import { cn } from '@/lib/utils';

/**
 * A summary figure (§7.5): label, value and an icon chip in the card's tone, with a bar of the tone along the
 * top so the four figures read apart at a glance. The whole card is a link with a visible focus ring.
 */
export function StatCard({
  icon: Icon,
  label,
  value,
  link,
  tone = 'primary',
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  link?: Pick<LinkProps, 'to' | 'search'>;
  tone?: Tone;
  /** Extra lines below the figure, such as the low-stock items. */
  children?: React.ReactNode;
}) {
  const body = (
    <Card
      className={cn(
        'relative h-full gap-3 overflow-hidden py-5 transition-[box-shadow,translate]',
        link && 'hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0',
      )}
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', TONE_BAR[tone])} />
      <CardContent className="flex flex-col gap-3 px-5">
        <div className="flex items-start justify-between gap-3">
          <span className="text-muted-foreground pt-1 text-sm font-medium">{label}</span>
          <span
            aria-hidden
            className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', TONE_CHIP[tone])}
          >
            <Icon className="size-5" />
          </span>
        </div>
        <span className="text-2xl font-bold tracking-tight break-words *:whitespace-normal">{value}</span>
        {children}
      </CardContent>
    </Card>
  );
  if (!link) return body;
  return (
    <Link
      {...link}
      className="focus-visible:ring-ring focus-visible:ring-offset-background block rounded-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
    >
      {body}
    </Link>
  );
}
