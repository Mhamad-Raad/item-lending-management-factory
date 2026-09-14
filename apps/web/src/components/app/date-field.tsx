import { businessToday } from '@pallet/shared';
import { useController, type Control, type FieldPath, type FieldValues } from 'react-hook-form';
import { DatePicker } from '@/components/app/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/app/field';

/**
 * A labelled business-date field of a react-hook-form form, with its error wired for screen readers (§7.9). Days after
 * today cannot be picked unless `max` says otherwise; a cleared box holds null, or undefined with `clearsToUndefined`
 * for a form whose schema reads a missing date as `required`.
 */
export function DateField<T extends FieldValues>({
  control,
  name,
  id,
  label,
  min,
  max = businessToday(),
  className,
  clearsToUndefined = false,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  id: string;
  label: string;
  min?: string;
  max?: string;
  className?: string;
  clearsToUndefined?: boolean;
}) {
  const { field, fieldState } = useController({ control, name });
  const errorId = `${id}-error`;
  return (
    <Field className={className}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DatePicker
        id={id}
        value={field.value as string | null | undefined}
        onChange={(value) => field.onChange(clearsToUndefined ? (value ?? undefined) : value)}
        onBlur={field.onBlur}
        min={min}
        max={max}
        invalid={Boolean(fieldState.error)}
        describedBy={errorId}
      />
      <FieldError id={errorId} message={fieldState.error?.message} />
    </Field>
  );
}
