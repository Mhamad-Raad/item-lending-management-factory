import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TabsList } from '@/components/ui/tabs';

/**
 * One set of choices drawn two ways (Q64): a dropdown below `md` and the segmented list from `md` up.
 *
 * A `TabsList` of four or more labels turns into a cramped sideways-scrolling strip on a phone — the later
 * choices sit off-screen with nothing to say they are there, and each one is too narrow to tap. The dropdown
 * shows the current choice at full width and opens the rest in a sheet the phone already knows how to draw.
 * Both halves read the same `value`, so whichever is on screen stays in step with the other.
 *
 * Give it the `TabsTrigger`s (or `RadioGroup` items) as `children`; they are only rendered from `md`.
 */
export function TabSelect<V extends string>({
  value,
  onChange,
  options,
  label,
  children,
}: {
  value: V;
  onChange: (value: V) => void;
  /** The same choices the segmented list shows, in the same order. */
  options: readonly { value: V; label: string }[];
  /** Names the control for a screen reader, on both halves. */
  label: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Select value={value} onValueChange={(next) => onChange(next as V)}>
        <SelectTrigger className="w-full md:hidden" aria-label={label}>
          <SelectValue placeholder={t('common.filters.all')} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <TabsList aria-label={label} className="hidden md:inline-flex">
        {children}
      </TabsList>
    </>
  );
}
