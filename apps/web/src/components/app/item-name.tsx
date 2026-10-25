import { ClampedText } from './clamped-text';

/**
 * An item's name where it shares a row or a card with figures (Q163): two lines at most, so a long name never makes
 * its row taller than its neighbours or pushes its controls out of line; printed papers show it in full. Expandable
 * where a count is typed against it, for two names may differ only at their end (`ClampedText`).
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
  return <ClampedText text={name} className={className} expandable={expandable} namedElsewhere={namedElsewhere} />;
}
