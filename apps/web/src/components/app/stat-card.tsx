import { Link, type LinkProps } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

/** A summary figure (§7.5): icon, label, value; the whole card is a link with a visible focus ring. */
export function StatCard({
  icon: Icon,
  label,
  value,
  link,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: React.ReactNode;
  link?: Pick<LinkProps, 'to' | 'search'>;
  /** Extra lines below the figure, such as the low-stock items. */
  children?: React.ReactNode;
}) {
  const body = (
    <Card className="hover:bg-accent/40 h-full gap-3 py-4 transition-colors">
      <CardContent className="flex flex-col gap-2 px-4">
        <span className="text-muted-foreground flex items-center gap-2 text-sm">
          <Icon className="size-4 shrink-0" aria-hidden />
          {label}
        </span>
        <span className="text-2xl font-semibold break-words *:whitespace-normal">{value}</span>
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
