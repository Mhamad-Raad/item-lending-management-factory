import { UPLOAD_ACCEPT, UPLOAD_MAX_BYTES, type UploadKind } from '@pallet/shared';
import { ImageIcon, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { apiUpload } from '@/lib/api-client';
import { ApiError } from '@/lib/api-error';

export interface UploadedImage {
  id: number;
  url: string;
}

/**
 * Picks an image and uploads it at once (§7.3.15, §7.5), so the form around it only ever holds the
 * returned upload id. Size and type are checked here first as a courtesy — the server reads the
 * content again and has the last word — and every failure is shown under the field.
 *
 * `onUploadingChange` lets the form hold its submit while an upload is in flight: saving mid-upload
 * would store the old image, report success, and then lose the new one.
 */
export function ImageUploadField({
  id,
  kind,
  value,
  onChange,
  onUploadingChange,
}: {
  id: string;
  kind: UploadKind;
  value: UploadedImage | null;
  onChange: (next: UploadedImage | null) => void;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File): Promise<void> => {
    setError(null);
    if (!(UPLOAD_ACCEPT as readonly string[]).includes(file.type)) {
      setError(t('errors.UPLOAD_TYPE_NOT_ALLOWED'));
      return;
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      setError(t('errors.UPLOAD_TOO_LARGE'));
      return;
    }

    setProgress(0);
    onUploadingChange?.(true);
    try {
      const uploaded = await apiUpload(kind, file, setProgress);
      onChange({ id: uploaded.id, url: uploaded.url });
    } catch (failure) {
      setError(
        failure instanceof ApiError ? t(`errors.${failure.code}`, { ...failure.details }) : t('errors.UNKNOWN_ERROR'),
      );
    } finally {
      setProgress(null);
      onUploadingChange?.(false);
      // Choosing the same file again must fire `change` again.
      if (input.current) input.current.value = '';
    }
  };

  const uploading = progress !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="bg-muted flex size-32 items-center justify-center overflow-hidden rounded-md border">
        {value ? (
          <img src={value.url} alt={t('common.upload.preview')} className="size-full object-contain" />
        ) : (
          <ImageIcon className="text-muted-foreground size-8" aria-hidden />
        )}
      </div>

      {/* The visible button is the control; the input stays out of the tab order. */}
      <input
        ref={input}
        id={id}
        type="file"
        tabIndex={-1}
        accept={UPLOAD_ACCEPT.join(',')}
        className="sr-only"
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
          <Upload aria-hidden />
          {t(value ? 'common.upload.replace' : 'common.upload.choose')}
        </Button>
        {value ? (
          <Button type="button" variant="ghost" disabled={uploading} onClick={() => onChange(null)}>
            {t('common.upload.remove')}
          </Button>
        ) : null}
      </div>

      {progress !== null ? (
        <progress value={progress} max={1} aria-label={t('common.upload.uploading')} className="h-2 w-full max-w-xs" />
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
