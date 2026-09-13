import type { LucideIcon } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { isRtl, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

export interface SegmentedOption<V extends string> {
  value: V;
  label: string;
  icon: LucideIcon;
}

/**
 * A choice between a few large option cards (§7.5): a Radix radio group, so arrow keys move between
 * them — in the reading direction, which is passed down for Kurdish and Arabic.
 */
export function SegmentedRadio<V extends string>({
  id,
  value,
  onChange,
  options,
  invalid = false,
  describedBy,
  label,
}: {
  id?: string;
  value: V | undefined;
  onChange: (value: V) => void;
  options: readonly SegmentedOption<V>[];
  invalid?: boolean;
  describedBy?: string;
  /** The accessible name of the group. */
  label: string;
}) {
  const { language } = usePreferences();
  return (
    <RadioGroupPrimitive.Root
      id={id}
      value={value ?? ''}
      onValueChange={(next) => onChange(next as V)}
      dir={isRtl(language) ? 'rtl' : 'ltr'}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      className="grid grid-cols-2 gap-3"
    >
      {options.map((option) => (
        <RadioGroupPrimitive.Item
          key={option.value}
          value={option.value}
          className={cn(
            'flex h-16 items-center justify-center gap-3 rounded-lg border text-base font-medium transition-colors outline-none',
            'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
            'data-[state=checked]:border-primary data-[state=checked]:bg-primary/10',
            invalid && 'border-destructive',
          )}
        >
          <option.icon className="size-5" aria-hidden />
          {option.label}
        </RadioGroupPrimitive.Item>
      ))}
    </RadioGroupPrimitive.Root>
  );
}
