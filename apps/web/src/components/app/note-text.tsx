import { ClampedText } from './clamped-text';

/**
 * A note where it sits among other details (Q165): two lines at most, its own line breaks kept, a tap showing it whole —
 * not every reader has an Edit to open (no permission, a reversed return), and a phone has no pointer for the title.
 */
export function NoteText({ text, className }: { text: string; className?: string }) {
  return <ClampedText text={text} className={className} expandable keepLines />;
}
