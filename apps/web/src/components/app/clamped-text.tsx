import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * Text cut to two lines among other details, the rest behind an ellipsis (Q163, Q165), the whole of it in `title` for a
 * pointer; screen readers read it all, the cut being visual only, and a word with no space to break at breaks anywhere
 * rather than widening its column. The cut sits on an inner box: a button lays its content out in a box of its own in
 * WebKit and Gecko.
 *
 * - `expandable`: a tap shows it whole and another cuts it again, for a phone has no pointer to show the title.
 * - `namedElsewhere`: the same words are given to screen readers by something else (a fieldset's legend), so this copy
 *   is for the eye and the finger only — hidden from them, out of the tab order, never taking focus on a tap.
 * - `keepLines`: its own line breaks are kept (a note).
 */
export function ClampedText({
  text,
  className,
  expandable = false,
  namedElsewhere = false,
  keepLines = false,
}: {
  text: string;
  className?: string;
  expandable?: boolean;
  namedElsewhere?: boolean;
  keepLines?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const inner = (
    <span className={cn('wrap-anywhere', keepLines && 'whitespace-pre-line', !open && 'line-clamp-2')}>
      <bdi>{text}</bdi>
    </span>
  );
  if (!expandable) {
    return (
      <span className={cn('block min-w-0', className)} title={text} aria-hidden={namedElsewhere || undefined}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      className={cn('block w-full min-w-0 text-start', className)}
      title={text}
      aria-expanded={namedElsewhere ? undefined : open}
      aria-hidden={namedElsewhere || undefined}
      tabIndex={namedElsewhere ? -1 : undefined}
      // Hidden from assistive technology, it must not take the focus a tap would give it.
      onMouseDown={namedElsewhere ? (event) => event.preventDefault() : undefined}
      onClick={() => setOpen((shown) => !shown)}
    >
      {inner}
    </button>
  );
}
