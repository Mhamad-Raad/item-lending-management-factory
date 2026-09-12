import { DayPicker, type DayPickerProps } from 'react-day-picker';
import 'react-day-picker/style.css';
import { useTranslation } from 'react-i18next';
import { isRtl, usePreferences } from '@/lib/preferences';

const MONTH_KEYS = [
  'common.months.1',
  'common.months.2',
  'common.months.3',
  'common.months.4',
  'common.months.5',
  'common.months.6',
  'common.months.7',
  'common.months.8',
  'common.months.9',
  'common.months.10',
  'common.months.11',
  'common.months.12',
] as const;

/** Indexed by `Date.getDay()`: 0 is Sunday. */
const WEEKDAY_KEYS = [
  'common.weekdaysShort.0',
  'common.weekdaysShort.1',
  'common.weekdaysShort.2',
  'common.weekdaysShort.3',
  'common.weekdaysShort.4',
  'common.weekdaysShort.5',
  'common.weekdaysShort.6',
] as const;

/** The theme's colours instead of react-day-picker's default blue. */
const THEME = {
  '--rdp-accent-color': 'var(--primary)',
  '--rdp-accent-background-color': 'var(--accent)',
  '--rdp-today-color': 'var(--primary)',
} as React.CSSProperties;

// shadcn/ui calendar on react-day-picker 10. RTL-audited (§7.11.1): the direction comes from the
// preferences, the week starts on Saturday, and month and weekday names come from the translations
// with Western digits.
export function Calendar({ style, ...props }: DayPickerProps) {
  const { t } = useTranslation();
  const { language } = usePreferences();

  return (
    <DayPicker
      dir={isRtl(language) ? 'rtl' : 'ltr'}
      weekStartsOn={6}
      numerals="latn"
      style={{ ...THEME, ...style }}
      formatters={{
        formatCaption: (month) => `${t(MONTH_KEYS[month.getMonth()] ?? MONTH_KEYS[0])} ${month.getFullYear()}`,
        formatWeekdayName: (weekday) => t(WEEKDAY_KEYS[weekday.getDay()] ?? WEEKDAY_KEYS[0]),
      }}
      {...props}
    />
  );
}
