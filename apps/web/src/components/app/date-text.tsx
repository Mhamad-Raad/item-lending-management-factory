import { formatBusinessDate, formatTimestamp, isBusinessDate } from '@pallet/shared';

/**
 * A business date (`YYYY-MM-DD`) or a timestamp, always as `dd/MM/yyyy` in Asia/Baghdad (§7.5).
 * A timestamp shows its time only with `withTime`.
 */
export function DateText({ value, withTime = false }: { value: string; withTime?: boolean }) {
  const text = isBusinessDate(value)
    ? formatBusinessDate(value)
    : withTime
      ? formatTimestamp(value)
      : formatTimestamp(value).slice(0, 10);

  return (
    <time dateTime={value} dir="ltr" className="whitespace-nowrap tabular-nums">
      {text}
    </time>
  );
}
