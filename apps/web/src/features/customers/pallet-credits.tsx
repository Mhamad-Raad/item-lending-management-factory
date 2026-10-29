import { zodResolver } from '@hookform/resolvers/zod';
import {
  PalletCreditHandBackBody,
  businessToday,
  formatNumber,
  type HandBackResultDto,
  type PalletCreditBalanceDto,
} from '@pallet/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandHelping, Printer } from 'lucide-react';
import { useRef, useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { DataTable, type DataColumn } from '@/components/app/data-table';
import { DateField } from '@/components/app/date-field';
import { Field, FieldError, FieldLabel } from '@/components/app/field';
import { ItemName } from '@/components/app/item-name';
import { QuantityInput } from '@/components/app/numeric-input';
import { QuantityText } from '@/components/app/quantity-text';
import { Thumbnail } from '@/components/app/thumbnail';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { invalidateAfterOrderChange } from '@/features/orders/api';
import { printRequest } from '@/features/receipt/print-receipt';
import { apiFetch } from '@/lib/api-client';
import { isApiError } from '@/lib/api-error';
import { isolate } from '@/lib/bidi';
import { handleApiError } from '@/lib/errors';
import { useIdempotencyKey } from '@/lib/idempotency';
import { qk } from '@/lib/query-keys';

/**
 * Q170: the pallets the factory owes the customer — what came back beyond what they had out — by type, each with
 * Give back. Nothing is drawn while the factory owes them nothing.
 */
export function PalletCreditsSection({ customerId, canGiveBack }: { customerId: number; canGiveBack: boolean }) {
  const { t } = useTranslation();
  // The item being given back; its amount is read from the list as it now stands, so a give-back by someone else
  // meanwhile (the list read again after a refusal) lowers what this dialog allows, or closes it at nothing owed.
  const [givingItemId, setGivingItemId] = useState<number | null>(null);
  const credits = useQuery({
    queryKey: qk.customers.palletCredits(customerId),
    queryFn: () => apiFetch<PalletCreditBalanceDto[]>(`/customers/${customerId}/pallet-credits`),
  });
  if (!credits.data || credits.data.length === 0) return null;
  const giving = credits.data.find((credit) => credit.item.id === givingItemId) ?? null;

  const columns: DataColumn<PalletCreditBalanceDto>[] = [
    {
      id: 'item',
      header: 'customers.holdings.item',
      cell: (credit) => (
        <span className="flex items-center gap-3">
          <Thumbnail url={credit.item.imageUrl} />
          <ItemName name={credit.item.name} />
        </span>
      ),
      wrap: true,
    },
    {
      id: 'quantity',
      header: 'customers.palletCredits.owed',
      cell: (credit) => <QuantityText value={credit.quantity} />,
      align: 'end',
    },
    ...(canGiveBack
      ? [
          {
            id: 'actions',
            header: 'common.actions.title',
            align: 'end',
            mobile: 'actions',
            cell: (credit: PalletCreditBalanceDto) => (
              <Button variant="outline" size="sm" onClick={() => setGivingItemId(credit.item.id)}>
                <HandHelping aria-hidden />
                {t('customers.palletCredits.giveBack')}
              </Button>
            ),
          } satisfies DataColumn<PalletCreditBalanceDto>,
        ]
      : []),
  ];

  // As the customer's other tables (the pallets they hold): a heading and a DataTable.
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">{t('customers.palletCredits.title')}</h2>
      <DataTable
        label={t('customers.palletCredits.title')}
        columns={columns}
        rows={credits.data}
        rowKey={(credit) => credit.item.id}
        // Never seen: the section is drawn only while something is owed.
        empty={null}
      />
      {giving ? (
        <GiveBackDialog
          key={giving.item.id}
          customerId={customerId}
          credit={giving}
          onOpenChange={(open) => {
            if (!open) setGivingItemId(null);
          }}
        />
      ) : null}
    </section>
  );
}

/** How many of what the factory owes go back to the customer now, and on which day (Q170). */
function GiveBackDialog({
  customerId,
  credit,
  onOpenChange,
}: {
  customerId: number;
  credit: PalletCreditBalanceDto;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const form = useForm({
    resolver: zodResolver(PalletCreditHandBackBody),
    mode: 'onTouched',
    defaultValues: { itemId: credit.item.id, quantity: credit.quantity, date: businessToday(), note: '' },
  });
  const errors = form.formState.errors;
  const over = (useWatch({ control: form.control, name: 'quantity' }) ?? 0) > credit.quantity;
  const edited = useRef(false);
  const close = (): void => onOpenChange(false);

  // One key per payload (§6.7): a press sent twice, or retried after a lost answer, gives back once.
  const idempotency = useIdempotencyKey();
  const giveBack = useMutation({
    mutationFn: (body: PalletCreditHandBackBody) =>
      apiFetch<HandBackResultDto>(`/customers/${customerId}/pallet-credits/hand-back`, {
        method: 'POST',
        body,
        idempotencyKey: idempotency.getKey(body),
      }),
    onSuccess: (result) => {
      idempotency.reset();
      // Its paper one press away, for the customer to sign for the pallets (Q172).
      const id = toast.success(t('customers.palletCredits.done'), {
        duration: 15_000,
        action: (
          <Button
            size="sm"
            onClick={() => {
              printRequest({ kind: 'hand-back', palletCreditId: result.palletCreditId });
              toast.dismiss(id);
            }}
          >
            <Printer aria-hidden />
            {t('orders.detail.printReceipt')}
          </Button>
        ),
      });
      close();
      // After the dialog is gone: refreshed under it, the new balance would flash the over-owed error first.
      void invalidateAfterOrderChange(queryClient);
    },
    onError: (error) => {
      if (isApiError(error, 'PALLET_CREDIT_INSUFFICIENT')) {
        void queryClient.invalidateQueries({ queryKey: qk.customers.palletCredits(customerId) });
      }
      handleApiError(error, { setError: form.setError, fields: ['quantity', 'date', 'note'] });
    },
  });

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent closeLabel={t('common.actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('customers.palletCredits.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('customers.palletCredits.dialogDescription', {
              item: isolate(credit.item.name),
              quantity: formatNumber(credit.quantity),
            })}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) =>
            void form.handleSubmit((values) =>
              giveBack.mutate({ ...values, note: values.note?.trim() ? values.note.trim() : null }),
            )(event)
          }
          className="flex flex-col gap-4"
          noValidate
        >
          <Field>
            <FieldLabel htmlFor="give-back-quantity">{t('customers.palletCredits.quantity')}</FieldLabel>
            <Controller
              control={form.control}
              name="quantity"
              render={({ field }) => (
                <QuantityInput
                  id="give-back-quantity"
                  // It starts at all that is owed: until something is typed, focusing or clicking the box selects that
                  // figure, so typing replaces it; once typing has begun, a click places the caret as usual.
                  onFocus={(event) => {
                    if (!edited.current) event.currentTarget.select();
                  }}
                  onMouseUp={(event) => {
                    if (edited.current) return;
                    event.preventDefault();
                    event.currentTarget.select();
                  }}
                  onKeyDown={() => {
                    edited.current = true;
                  }}
                  onBlur={field.onBlur}
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? undefined)}
                  aria-invalid={Boolean(errors.quantity) || over}
                  aria-describedby="give-back-quantity-error"
                />
              )}
            />
            {/* Refused as typed (Q141): no more than the factory owes them. */}
            {over ? (
              <p id="give-back-quantity-error" role="alert" className="text-destructive text-sm">
                {t('customers.palletCredits.overOwed', { quantity: formatNumber(credit.quantity) })}
              </p>
            ) : (
              <FieldError id="give-back-quantity-error" message={errors.quantity?.message} />
            )}
          </Field>
          <DateField control={form.control} name="date" id="give-back-date" label={t('orders.money.date')} />
          <Field>
            <FieldLabel htmlFor="give-back-note">{t('orders.money.note')}</FieldLabel>
            <Input id="give-back-note" {...form.register('note')} />
            <FieldError id="give-back-note-error" message={errors.note?.message} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              {t('common.actions.cancel')}
            </Button>
            <Button type="submit" disabled={giveBack.isPending || over}>
              {t('customers.palletCredits.giveBack')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
