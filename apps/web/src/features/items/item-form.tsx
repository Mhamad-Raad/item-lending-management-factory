import { zodResolver } from '@hookform/resolvers/zod';
import {
  InitialBatchBody,
  Money,
  Name200,
  NonNegQuantity,
  businessToday,
  type ItemCreateBody,
  type ItemDto,
  type ItemUpdateBody,
} from '@pallet/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { z } from 'zod';
import { DatePicker } from '@/components/app/date-picker';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/app/field';
import { ImageUploadField, type UploadedImage } from '@/components/app/image-upload-field';
import { MoneyInput, QuantityInput } from '@/components/app/numeric-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { apiFetch } from '@/lib/api-client';
import { useCan } from '@/lib/auth';
import { handleApiError } from '@/lib/errors';
import { qk } from '@/lib/query-keys';
import { invalidateStock } from './api';

/** Empty boxes are null in the form; the shared batch schema then reports them as required. */
const InitialBatchDraft = z.object({
  date: z.string().nullable(),
  quantity: z.number().nullable(),
  unitCost: z.number().nullable(),
  note: z.string(),
});
type InitialBatchDraft = z.infer<typeof InitialBatchDraft>;

function batchInput(draft: InitialBatchDraft) {
  return {
    date: draft.date ?? undefined,
    quantity: draft.quantity ?? undefined,
    unitCost: draft.unitCost ?? undefined,
    note: draft.note,
  };
}

/**
 * The item's fields plus the UI-only "add initial stock" switch (§7.9): the first batch is checked
 * against the shared `InitialBatchBody` only while the switch is on.
 */
const ItemFormSchema = z
  .object({
    name: Name200,
    depositPrice: Money,
    minStock: NonNegQuantity.nullable(),
    addInitialStock: z.boolean(),
    initialBatch: InitialBatchDraft,
  })
  .superRefine((values, ctx) => {
    if (!values.addInitialStock) return;
    const result = InitialBatchBody.safeParse(batchInput(values.initialBatch));
    if (result.success) return;
    for (const issue of result.error.issues) {
      ctx.addIssue({ code: 'custom', path: ['initialBatch', ...issue.path], message: issue.message });
    }
  });
type ItemFormValues = z.output<typeof ItemFormSchema>;

const FIELDS = [
  'name',
  'depositPrice',
  'minStock',
  'initialBatch.date',
  'initialBatch.quantity',
  'initialBatch.unitCost',
  'initialBatch.note',
] as const;

/** Creates an item — with its first delivery when the user may record purchases — or edits one (§7.3.15). */
export function ItemForm({ item }: { item?: ItemDto }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canAddStock = useCan('purchases.create') && !item;
  const [image, setImage] = useState<UploadedImage | null>(
    item?.imageUploadId != null && item.imageUrl ? { id: item.imageUploadId, url: item.imageUrl } : null,
  );
  const [uploading, setUploading] = useState(false);

  const form = useForm({
    resolver: zodResolver(ItemFormSchema),
    mode: 'onTouched',
    defaultValues: {
      name: item?.name ?? '',
      depositPrice: item?.depositPrice,
      minStock: item?.minStock ?? null,
      addInitialStock: false,
      initialBatch: { date: businessToday(), quantity: null, unitCost: null, note: '' },
    },
  });
  const addInitialStock = useWatch({ control: form.control, name: 'addInitialStock' });
  const errors = form.formState.errors;
  const imageChanged = (image?.id ?? null) !== (item?.imageUploadId ?? null);
  const guard = useUnsavedChangesGuard(form.formState.isDirty || imageChanged);

  const save = useMutation({
    mutationFn: (values: ItemFormValues) => {
      const fields = {
        name: values.name,
        depositPrice: values.depositPrice,
        minStock: values.minStock,
        imageUploadId: image?.id ?? null,
      };
      if (item) {
        const body: ItemUpdateBody = { version: item.version, ...fields };
        return apiFetch<ItemDto>(`/items/${item.id}`, { method: 'PATCH', body });
      }
      const body: ItemCreateBody = {
        ...fields,
        ...(values.addInitialStock ? { initialBatch: InitialBatchBody.parse(batchInput(values.initialBatch)) } : {}),
      };
      return apiFetch<ItemDto>('/items', { method: 'POST', body });
    },
    onSuccess: async (saved) => {
      await invalidateStock(queryClient);
      toast.success(t(item ? 'items.form.saved' : 'items.form.created'));
      guard.allowLeave();
      await navigate({ to: '/items/$itemId', params: { itemId: String(saved.id) } });
    },
    onError: (error) =>
      handleApiError(error, {
        setError: form.setError,
        fields: FIELDS,
        fieldMap: { BUSINESS_DATE_IN_FUTURE: 'initialBatch.date' },
        onReload: item ? () => void queryClient.invalidateQueries({ queryKey: qk.items.detail(item.id) }) : undefined,
      }),
  });

  return (
    <form
      onSubmit={form.handleSubmit((values) => save.mutate(values))}
      className="flex max-w-2xl flex-col gap-6"
      noValidate
    >
      <Card>
        <CardContent className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="name">{t('items.fields.name')}</FieldLabel>
            <Input
              id="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby="name-error"
              {...form.register('name')}
            />
            <FieldError id="name-error" message={errors.name?.message} />
          </Field>

          <Field>
            <FieldLabel htmlFor="image">{t('items.fields.image')}</FieldLabel>
            <ImageUploadField
              id="image"
              kind="ITEM_IMAGE"
              value={image}
              onChange={setImage}
              onUploadingChange={setUploading}
            />
            <FieldDescription>{t('common.upload.hint')}</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="depositPrice">{t('items.fields.depositPrice')}</FieldLabel>
            <Controller
              control={form.control}
              name="depositPrice"
              render={({ field }) => (
                <MoneyInput
                  id="depositPrice"
                  value={field.value}
                  onChange={(value) => field.onChange(value ?? undefined)}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.depositPrice)}
                  aria-describedby="depositPrice-help depositPrice-error"
                />
              )}
            />
            {item ? (
              <FieldDescription id="depositPrice-help">{t('items.form.depositPriceHelp')}</FieldDescription>
            ) : null}
            <FieldError id="depositPrice-error" message={errors.depositPrice?.message} />
          </Field>

          <Field>
            <FieldLabel htmlFor="minStock">{t('items.fields.minStock')}</FieldLabel>
            <Controller
              control={form.control}
              name="minStock"
              render={({ field }) => (
                <QuantityInput
                  id="minStock"
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  aria-invalid={Boolean(errors.minStock)}
                  aria-describedby="minStock-help minStock-error"
                />
              )}
            />
            <FieldDescription id="minStock-help">{t('items.form.minStockHelp')}</FieldDescription>
            <FieldError id="minStock-error" message={errors.minStock?.message} />
          </Field>
        </CardContent>
      </Card>

      {canAddStock ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('items.form.initialStock')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Controller
                control={form.control}
                name="addInitialStock"
                render={({ field }) => (
                  <Switch
                    id="addInitialStock"
                    checked={field.value}
                    onCheckedChange={(on) => {
                      field.onChange(on);
                      // Today as of switching it on: a form left open overnight must not offer yesterday.
                      if (on && !form.getFieldState('initialBatch.date').isDirty) {
                        form.setValue('initialBatch.date', businessToday());
                      }
                    }}
                  />
                )}
              />
              <Label htmlFor="addInitialStock" className="font-normal">
                {t('items.form.addInitialStock')}
              </Label>
            </div>

            {addInitialStock ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="batch-date">{t('purchases.fields.date')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="initialBatch.date"
                    render={({ field }) => (
                      <DatePicker
                        id="batch-date"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        max={businessToday()}
                        invalid={Boolean(errors.initialBatch?.date)}
                        describedBy="batch-date-error"
                      />
                    )}
                  />
                  <FieldError id="batch-date-error" message={errors.initialBatch?.date?.message} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="batch-quantity">{t('purchases.fields.quantity')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="initialBatch.quantity"
                    render={({ field }) => (
                      <QuantityInput
                        id="batch-quantity"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-invalid={Boolean(errors.initialBatch?.quantity)}
                        aria-describedby="batch-quantity-error"
                      />
                    )}
                  />
                  <FieldError id="batch-quantity-error" message={errors.initialBatch?.quantity?.message} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="batch-unitCost">{t('purchases.fields.unitCost')}</FieldLabel>
                  <Controller
                    control={form.control}
                    name="initialBatch.unitCost"
                    render={({ field }) => (
                      <MoneyInput
                        id="batch-unitCost"
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        aria-invalid={Boolean(errors.initialBatch?.unitCost)}
                        aria-describedby="batch-unitCost-error"
                      />
                    )}
                  />
                  <FieldError id="batch-unitCost-error" message={errors.initialBatch?.unitCost?.message} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="batch-note">{t('purchases.fields.note')}</FieldLabel>
                  <Input id="batch-note" aria-describedby="batch-note-error" {...form.register('initialBatch.note')} />
                  <FieldError id="batch-note-error" message={errors.initialBatch?.note?.message} />
                </Field>
              </div>
            ) : (
              <FieldDescription>{t('items.form.noInitialStockHelp')}</FieldDescription>
            )}
          </CardContent>
        </Card>
      ) : null}

      <div className="flex gap-2">
        {/* Held while an image is still uploading, or the save would carry the old one. */}
        <Button type="submit" disabled={save.isPending || uploading}>
          {t('common.actions.save')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            void (item
              ? navigate({ to: '/items/$itemId', params: { itemId: String(item.id) } })
              : navigate({ to: '/items' }))
          }
        >
          {t('common.actions.cancel')}
        </Button>
      </div>
      {guard.dialog}
    </form>
  );
}
