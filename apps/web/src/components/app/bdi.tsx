/**
 * A table cell's plain text is usually something people typed (a name, a note): it is isolated so its own
 * direction holds inside a right-to-left page (§7.11). Cells that render elements isolate what they need.
 */
export function isolated(value: React.ReactNode): React.ReactNode {
  return typeof value === 'string' ? <bdi>{value}</bdi> : value;
}
