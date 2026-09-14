/** The accent colours a card, chip or tile may carry (Q50); each is a full class string so Tailwind sees it. */
export type Tone = 'primary' | 'success' | 'warning' | 'info' | 'destructive';

/** A soft square behind an icon: the tint of the tone, the icon in the tone itself. */
export const TONE_CHIP: Readonly<Record<Tone, string>> = {
  primary: 'bg-primary/12 text-primary dark:bg-primary/20',
  success: 'bg-success/12 text-success dark:bg-success/20',
  warning: 'bg-warning/12 text-warning dark:bg-warning/20',
  info: 'bg-info/12 text-info dark:bg-info/20',
  destructive: 'bg-destructive/12 text-destructive dark:bg-destructive/20',
};

/** A thin bar along a card's top edge in the tone. */
export const TONE_BAR: Readonly<Record<Tone, string>> = {
  primary: 'bg-primary',
  success: 'bg-success',
  warning: 'bg-warning',
  info: 'bg-info',
  destructive: 'bg-destructive',
};
