import { FONT_SIZE_PX, type FontFamily, type FontSize } from '@pallet/shared';

// Sorani letters that most Arabic faces lack (ڕ ۆ ێ ڵ ە), so a face missing one shows it here first.
const SORANI_SPECIMEN = 'پالێتی دارین، ڕۆژانە';
const DIGITS_SPECIMEN = 'Aa 0123456789';

/**
 * One typeface as it renders: `data-font` sets `--app-font` on this box, and the text reads it, so the sample is
 * drawn in the face itself — Sorani above, Latin and digits below, each isolated in its own direction.
 */
export function FontSpecimen({ font }: { font: FontFamily }) {
  return (
    <div
      aria-hidden
      data-font={font}
      className="bg-muted/40 flex flex-col gap-0.5 px-3 py-3 text-center"
      style={{ fontFamily: 'var(--app-font)' }}
    >
      <p lang="ckb" dir="rtl" className="truncate text-lg">
        {SORANI_SPECIMEN}
      </p>
      <p dir="ltr" className="text-muted-foreground truncate text-xs">
        {DIGITS_SPECIMEN}
      </p>
    </div>
  );
}

/**
 * A field drawn at the size the option produces. The app scales through the root font size, so the specimen sets
 * that size on its own box and sizes everything inside in `em`: a `rem` preview would draw every card alike.
 */
export function TextSizeSpecimen({ size, label, value }: { size: FontSize; label: string; value: string }) {
  return (
    <div aria-hidden className="bg-muted/40 px-3 py-3" style={{ fontSize: `${FONT_SIZE_PX[size]}px` }}>
      <p className="text-muted-foreground" style={{ fontSize: '0.75em', marginBottom: '0.25em' }}>
        {label}
      </p>
      <p
        className="border-input bg-background truncate rounded-md border"
        style={{ fontSize: '0.875em', padding: '0.45em 0.7em' }}
      >
        {value}
      </p>
    </div>
  );
}
