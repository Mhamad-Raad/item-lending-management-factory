import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Controller, useFieldArray, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { EntityCombobox } from '@/components/app/entity-combobox';
import { FieldError } from '@/components/app/field';
import { MoneyText } from '@/components/app/money-text';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { encodeValidationMessage } from '@/lib/validation-message';
import type { OrderFormValues } from './order-form';
import { EMPTY_LINE } from './order-lines';

const itemFieldId = (index: number): string => `lines-${index}-item`;

/**
 * The lines of an order (§7.4.1): one item per row, its quantity, its deposit and its live total.
 * Enter in the last row's quantity adds a row instead of submitting — the one Enter override, which
 * the field's hint announces.
 */
export function OrderLinesEditor({
  form,
  defaultDeposit,
  available,
  canPrice,
  disabled = false,
}: {
  form: UseFormReturn<OrderFormValues>;
  /** The deposit a row starts from: the item's, or the stored one for a line already on the order. */
  defaultDeposit: (itemId: number) => number | undefined;
  /** How many pallets a row may take; undefined until the item is known. */
  available: (itemId: number) => number | undefined;
  canPrice: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'lines' });
  const rows = useWatch({ control: form.control, name: 'lines' });
  const errors = form.formState.errors.lines;

  const addRow = (): void => {
    append({ ...EMPTY_LINE });
    // The new row's picker exists after this render.
    requestAnimationFrame(() => document.getElementById(itemFieldId(fields.length))?.focus());
  };

  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, index) => {
        const row = rows[index] ?? EMPTY_LINE;
        const unitDeposit = row.itemId === null ? undefined : (row.unitDeposit ?? defaultDeposit(row.itemId));
        const limit = row.itemId === null ? undefined : available(row.itemId);
        const overStock = limit !== undefined && row.quantity !== null && row.quantity > limit;
        const quantityError = overStock
          ? encodeValidationMessage('stockExceeded', { available: limit })
          : errors?.[index]?.quantity?.message;
        const otherItems = rows.flatMap((other, otherIndex) =>
          otherIndex !== index && other.itemId !== null ? [other.itemId] : [],
        );
        const isLast = index === fields.length - 1;

        return (
          <div
            key={field.id}
            className="grid gap-3 rounded-md border p-3 md:grid-cols-[minmax(0,1fr)_7rem_9rem_8rem_2.5rem] md:items-start"
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor={itemFieldId(index)} className="text-muted-foreground text-xs">
                {t('orders.lines.item')}
              </Label>
              <Controller
                control={form.control}
                name={`lines.${index}.itemId`}
                render={({ field: itemField }) => (
                  <EntityCombobox
                    id={itemFieldId(index)}
                    kind="item"
                    value={itemField.value}
                    excludeIds={otherItems}
                    disabled={disabled}
                    invalid={Boolean(errors?.[index]?.itemId)}
                    placeholder={t('orders.lines.chooseItem')}
                    onChange={(itemId) => {
                      itemField.onChange(itemId);
                      // Null follows the item's deposit as it loads and changes; only a typed value is the user's.
                      form.setValue(`lines.${index}.unitDeposit`, null);
                    }}
                  />
                )}
              />
              <FieldError id={`lines-${index}-item-error`} message={errors?.[index]?.itemId?.message} />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`lines-${index}-quantity`} className="text-muted-foreground text-xs">
                {t('orders.lines.quantity')}
              </Label>
              <Controller
                control={form.control}
                name={`lines.${index}.quantity`}
                render={({ field: quantityField }) => (
                  <QuantityInput
                    id={`lines-${index}-quantity`}
                    value={quantityField.value}
                    onChange={quantityField.onChange}
                    onBlur={quantityField.onBlur}
                    disabled={disabled}
                    aria-invalid={Boolean(quantityError)}
                    aria-describedby={`lines-${index}-quantity-error${isLast ? ' lines-enter-hint' : ''}`}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && isLast) {
                        event.preventDefault();
                        addRow();
                      }
                    }}
                  />
                )}
              />
              <FieldError id={`lines-${index}-quantity-error`} message={quantityError} />
            </div>

            <div className="flex flex-col gap-1">
              <Label htmlFor={`lines-${index}-unitDeposit`} className="text-muted-foreground text-xs">
                {t('orders.lines.unitDeposit')}
              </Label>
              {canPrice && row.itemId !== null ? (
                <Controller
                  control={form.control}
                  name={`lines.${index}.unitDeposit`}
                  render={({ field: depositField }) => (
                    <UnitDepositInput
                      id={`lines-${index}-unitDeposit`}
                      value={depositField.value}
                      fallback={row.itemId === null ? undefined : defaultDeposit(row.itemId)}
                      onChange={depositField.onChange}
                      onBlur={depositField.onBlur}
                      disabled={disabled}
                    />
                  )}
                />
              ) : (
                <output id={`lines-${index}-unitDeposit`} className="flex h-10 items-center">
                  {unitDeposit === undefined ? '—' : <MoneyText value={unitDeposit} />}
                </output>
              )}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{t('orders.lines.lineTotal')}</span>
              <span className="flex h-10 items-center font-medium">
                {unitDeposit === undefined || row.quantity === null ? (
                  '—'
                ) : (
                  <MoneyText value={row.quantity * unitDeposit} />
                )}
              </span>
            </div>

            <div className="flex md:pt-5">
              {fields.length > 1 && !disabled ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('orders.lines.remove')}
                  onClick={() => remove(index)}
                >
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </div>
          </div>
        );
      })}

      {typeof errors?.message === 'string' || typeof errors?.root?.message === 'string' ? (
        <FieldError id="lines-error" message={errors?.message ?? errors?.root?.message} />
      ) : null}
      {disabled ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={addRow}>
            <Plus aria-hidden />
            {t('orders.lines.add')}
          </Button>
          <span id="lines-enter-hint" className="text-muted-foreground text-xs">
            {t('orders.lines.enterHint')}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * A line's deposit. Null means "the item's deposit", shown as that number until the user edits it. While the box has
 * focus it shows exactly what is typed, so it can be emptied and typed again; left empty, or set back to the default, it
 * follows the default once more, and a later change to the item's price is not frozen into the line.
 */
function UnitDepositInput({
  id,
  value,
  fallback,
  onChange,
  onBlur,
  disabled,
}: {
  id: string;
  value: number | null;
  fallback: number | undefined;
  onChange: (value: number | null) => void;
  onBlur: () => void;
  disabled: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <MoneyInput
      id={id}
      value={editing ? value : (value ?? fallback ?? null)}
      onFocus={() => {
        setEditing(true);
        if (value === null && fallback !== undefined) onChange(fallback);
      }}
      onChange={onChange}
      onBlur={() => {
        setEditing(false);
        if (value === null || value === fallback) onChange(null);
        onBlur();
      }}
      disabled={disabled}
    />
  );
}
