import { formatBusinessDate } from '@pallet/shared';
import { CalendarDays } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  businessDateToLocal,
  localToBusinessDate,
  parseTypedDate,
  sanitizeTypedDate,
  TYPED_DATE_MAX_LENGTH,
} from '@/lib/date-input';

interface DatePickerProps {
  id?: string;
  /** A business date `YYYY-MM-DD`; null or undefined for none. */
  value: string | null | undefined;
  onChange: (value: string | null) => void;
  onBlur?: () => void;
  /** Earliest and latest selectable days, as business dates. */
  min?: string;
  max?: string;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
}

/**
 * A business date, typed as `dd/MM/yyyy` or picked from the calendar (§7.5). What was typed stays in
 * the box until it is a real day; until then the value is null, so the form reports it.
 */
export function DatePicker({ id, value, onChange, onBlur, min, max, invalid, disabled, describedBy }: DatePickerProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(value ? formatBusinessDate(value) : '');
  const [seen, setSeen] = useState(value ?? null);

  // Follow a value set from outside (a reset, a default), not one this box has just produced.
  if ((value ?? null) !== seen) {
    setSeen(value ?? null);
    setText(value ? formatBusinessDate(value) : '');
  }

  const choose = (next: string | null): void => {
    setSeen(next);
    onChange(next);
  };
  const commitText = (): void => {
    const parsed = parseTypedDate(text);
    if (parsed) setText(formatBusinessDate(parsed));
    // Passing through the box without changing it is no change: a filter must keep its page.
    if (parsed !== (value ?? null)) choose(parsed);
  };

  const disabledDays = [
    ...(min ? [{ before: businessDateToLocal(min) }] : []),
    ...(max ? [{ after: businessDateToLocal(max) }] : []),
  ];
  const month = value ? businessDateToLocal(value) : max ? businessDateToLocal(max) : undefined;

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        dir="ltr"
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('common.datePicker.placeholder')}
        className="tabular-nums"
        value={text}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        // Only a date's characters get in: a letter typed is not shown at all, and a full box takes no more (Q148).
        onChange={(event) => {
          const box = event.target;
          const raw = box.value;
          const at = box.selectionStart ?? raw.length;
          let kept = sanitizeTypedDate(raw);
          let caretAt = sanitizeTypedDate(raw.slice(0, at)).length;
          if (kept.length > TYPED_DATE_MAX_LENGTH) {
            // Refused whole: the box keeps what it had, the caret where it was before the keystroke.
            kept = text;
            caretAt = Math.max(0, at - (raw.length - text.length));
          }
          // Written to the box here, with the caret, so a dropped keystroke never sends the caret to the end.
          box.value = kept;
          box.setSelectionRange(caretAt, caretAt);
          setText(kept);
        }}
        onBlur={() => {
          commitText();
          onBlur?.();
        }}
        onKeyDown={(event) => {
          // Enter also submits the form: the typed date has to be in the form before that happens.
          if (event.key === 'Enter') commitText();
        }}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            disabled={disabled}
            aria-label={t('common.datePicker.open')}
          >
            <CalendarDays aria-hidden />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2">
          <Calendar
            mode="single"
            selected={value ? businessDateToLocal(value) : undefined}
            defaultMonth={month}
            disabled={disabledDays}
            onSelect={(date) => {
              if (!date) return;
              const next = localToBusinessDate(date);
              setText(formatBusinessDate(next));
              choose(next);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Two linked days: the start cannot pass the end, nor the end precede the start. */
export function DateRangePicker({
  idPrefix,
  from,
  to,
  onChange,
  max,
  error,
}: {
  idPrefix: string;
  from: string | undefined;
  to: string | undefined;
  onChange: (range: { from: string | undefined; to: string | undefined }) => void;
  max?: string;
  /** Shown under the end date, which is the field the user corrects. */
  error?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-from`}>{t('common.dateRange.from')}</Label>
        <DatePicker
          id={`${idPrefix}-from`}
          value={from}
          max={to ?? max}
          onChange={(next) => onChange({ from: next ?? undefined, to })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={`${idPrefix}-to`}>{t('common.dateRange.to')}</Label>
        <DatePicker
          id={`${idPrefix}-to`}
          value={to}
          min={from}
          max={max}
          invalid={Boolean(error)}
          describedBy={error ? `${idPrefix}-error` : undefined}
          onChange={(next) => onChange({ from, to: next ?? undefined })}
        />
      </div>
      {error ? (
        <p id={`${idPrefix}-error`} role="alert" className="text-destructive basis-full text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
