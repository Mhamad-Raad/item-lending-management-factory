import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * An item's name where it shares a row or a card with figures (Q163): two lines at most, the rest cut with an
 * ellipsis, so a long name never makes its row taller than its neighbours or pushes its controls out of line. The
 * whole name stays in the page — screen readers read it all, a pointer shows it — and printed papers show it in full.
 * `expandable` (where a count is typed against it): a tap shows it whole, and another cuts it again, since a phone or a
 * tablet has no pointer to show the rest, and two names may differ only at their end. `namedElsewhere`: the item is
 * already named for screen readers (a fieldset's legend), so this copy is for the eye and the finger only.
 */
export function ItemName({
  name,
  className,
  expandable = false,
  namedElsewhere = false,
}: {
  name: string;
  className?: string;
  expandable?: boolean;
  namedElsewhere?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // The clamp sits on an inner box: a button lays its content out in a box of its own in WebKit and Gecko.
  const text = (
    <span className={cn('wrap-anywhere', !open && 'line-clamp-2')}>
      <bdi>{name}</bdi>
    </span>
  );
  if (!expandable) {
    return (
      <span className={cn('block min-w-0', className)} title={name} aria-hidden={namedElsewhere || undefined}>
        {text}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn('block w-full min-w-0 text-start', className)}
      title={name}
      aria-expanded={namedElsewhere ? undefined : open}
      aria-hidden={namedElsewhere || undefined}
      tabIndex={namedElsewhere ? -1 : undefined}
      // Hidden from assistive technology, it must not take the focus a tap would give it.
      onMouseDown={namedElsewhere ? (event) => event.preventDefault() : undefined}
      onClick={() => setOpen((shown) => !shown)}
    >
      {text}
    </button>
  );
}
