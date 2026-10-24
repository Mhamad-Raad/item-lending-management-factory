import { useState } from 'react';
import { cn } from '@/lib/utils';

/**
 * A note where it sits among other details (Q165): two lines at most, the rest cut with an ellipsis, its own line
 * breaks kept. A tap shows it whole and another cuts it again — not every reader has an Edit to open (no permission,
 * a reversed return), and a phone has no pointer to show the title. Screen readers read it all; a word with no space
 * to break at (a code, a link) breaks anywhere rather than widening its column.
 */
export function NoteText({ text, className }: { text: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      className={cn('block w-full min-w-0 text-start', className)}
      title={text}
      aria-expanded={open}
      onClick={() => setOpen((shown) => !shown)}
    >
      <span className={cn('wrap-anywhere whitespace-pre-line', !open && 'line-clamp-2')}>
        <bdi>{text}</bdi>
      </span>
    </button>
  );
}
