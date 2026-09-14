import { Check } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * One choice in an appearance group: a real radio inside its label, so the group is announced as single-select
 * and arrow keys move through it in the reading direction. The radio is invisible and spans the card.
 */
export function OptionCard({
  name,
  value,
  selected,
  onSelect,
  title,
  description,
  icon,
  children,
}: {
  name: string;
  value: string;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  icon?: ReactNode;
  children?: ReactNode;
}) {
  const descriptionId = useId();
  return (
    <label
      className={cn(
        'bg-card relative flex cursor-pointer flex-col overflow-hidden rounded-lg border transition-[box-shadow,border-color]',
        'has-[:focus-visible]:ring-ring hover:shadow-md has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2',
        selected ? 'border-primary ring-primary shadow-sm ring-2' : 'hover:border-primary/50',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        // Named by its title alone: the preview inside the label is a picture, not part of the name.
        aria-label={title}
        aria-describedby={description ? descriptionId : undefined}
        // Transparent over the whole card, so a press anywhere on it lands on the radio itself.
        className="absolute inset-0 z-10 cursor-pointer appearance-none opacity-0"
      />
      {children ? <div className="border-b">{children}</div> : null}
      <div className="flex min-h-14 items-center gap-3 p-3">
        {icon ? (
          <span
            aria-hidden
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-md',
              selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </span>
        ) : null}
        {/* min-w-0 lets a long translated name truncate instead of widening the grid. */}
        <div className="min-w-0 flex-1 pe-6">
          <p className="truncate text-sm font-medium">{title}</p>
          {description ? (
            <p id={descriptionId} className="text-muted-foreground truncate text-xs">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {selected ? (
        <span
          aria-hidden
          className="bg-primary text-primary-foreground pointer-events-none absolute end-2 bottom-4 flex size-6 items-center justify-center rounded-full"
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : null}
    </label>
  );
}
