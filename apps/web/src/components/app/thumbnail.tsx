import { Package } from 'lucide-react';
import { cn } from '@/lib/utils';

const SIZES = { sm: 'size-8', md: 'size-10', lg: 'size-32' } as const;

/** An item's picture, cropped to a square; the `Package` icon stands in when it has none (§7.3.14). */
export function Thumbnail({ url, size = 'md' }: { url: string | null | undefined; size?: keyof typeof SIZES }) {
  return (
    <span
      className={cn(
        'bg-muted flex shrink-0 items-center justify-center overflow-hidden rounded-md border',
        SIZES[size],
      )}
    >
      {url ? (
        <img src={url} alt="" className="size-full object-cover" />
      ) : (
        <Package className={cn('text-muted-foreground', size === 'lg' ? 'size-8' : 'size-4')} aria-hidden />
      )}
    </span>
  );
}
