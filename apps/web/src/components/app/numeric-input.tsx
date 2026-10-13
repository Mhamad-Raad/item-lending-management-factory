import { formatNumber } from '@pallet/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { caretAfterDigits, digitsBefore, parseNumericInput } from '@/lib/numeric-input';
import { cn } from '@/lib/utils';

interface NumericInputProps extends Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'type' | 'ref'> {
  /** null = an empty box. */
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  allowNegative?: boolean;
  /** A unit shown inside the box at its end, such as the currency, so the box says what it holds. */
  suffix?: string;
}

function textOf(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : formatNumber(value);
}

/**
 * The only way numbers are typed in the app (§7.5): never `<input type="number">`, which ignores
 * Eastern digits and shows no separators. The box keeps its own text while the user types and
 * follows the form when the value changes from outside (a reset, a default).
 */
function NumericInput({ value, onChange, allowNegative = false, suffix, className, ...props }: NumericInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const [text, setText] = useState(() => textOf(value));
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    setSeen(value);
    if (parseNumericInput(text, allowNegative).value !== (value ?? null)) setText(textOf(value));
  }

  useLayoutEffect(() => {
    if (caret.current === null || !input.current) return;
    input.current.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  const box = (
    <Input
      {...props}
      ref={input}
      type="text"
      // A phone's numeric keypad has no minus key, so a signed box asks for the full keyboard.
      inputMode={allowNegative ? 'text' : 'numeric'}
      dir="ltr"
      autoComplete="off"
      className={cn('tabular-nums', suffix ? 'pe-16' : className)}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        const next = parseNumericInput(raw, allowNegative);
        caret.current = caretAfterDigits(next.text, digitsBefore(raw, event.target.selectionStart ?? raw.length));
        setText(next.text);
        setSeen(next.value);
        onChange(next.value);
      }}
    />
  );
  if (!suffix) return box;
  // The digits read left to right in every language, so the unit sits at the box's right in all of them.
  return (
    // Sizing classes go on the wrapper, so the unit stays inside whatever width the box is given.
    <div dir="ltr" className={cn('relative', className)}>
      {box}
      <span
        className="text-muted-foreground pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm"
        aria-hidden
      >
        {suffix}
      </span>
    </div>
  );
}

/** Whole IQD, 0 or more. */
export function MoneyInput(props: Omit<NumericInputProps, 'allowNegative'>) {
  return <NumericInput {...props} />;
}

/** A count of pallets; `allowNegative` for a stock adjustment. */
export function QuantityInput(props: NumericInputProps) {
  return <NumericInput {...props} />;
}
