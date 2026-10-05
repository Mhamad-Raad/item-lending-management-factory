import { Input } from '@/components/ui/input';
import { keepPhoneCharacters } from '@/lib/phone-input';

/**
 * A box for a phone number: what is not part of one — a letter, a stray sign — never appears in it, rather than
 * being refused only when the form is saved. It reads left to right in every language of the app.
 */
export function PhoneInput({ onChange, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <Input
      {...props}
      type="text"
      inputMode="tel"
      dir="ltr"
      autoComplete="off"
      onChange={(event) => {
        const box = event.target;
        const kept = keepPhoneCharacters(box.value);
        if (kept !== box.value) {
          // The caret stays where the typing was, not at the end of the box.
          const caret = keepPhoneCharacters(box.value.slice(0, box.selectionStart ?? box.value.length)).length;
          box.value = kept;
          box.setSelectionRange(caret, caret);
        }
        onChange?.(event);
      }}
    />
  );
}
