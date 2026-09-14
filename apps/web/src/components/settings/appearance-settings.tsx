import {
  FONT_FAMILIES,
  FONT_SIZES,
  PALETTES,
  THEMES,
  type FontFamily,
  type FontSize,
  type Palette,
  type Theme,
} from '@pallet/shared';
import { Monitor, Moon, Sun, type LucideIcon } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { OptionCard } from '@/components/settings/option-card';
import { FontSpecimen, TextSizeSpecimen } from '@/components/settings/specimens';
import { ThemePreview } from '@/components/settings/theme-preview';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { resolveTheme, setPreferences, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';

const MODE_ICONS: Record<Theme, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };

/** A titled radio group of option cards, named by its card title and described by its hint. */
function OptionGroup({
  title,
  hint,
  columns,
  children,
}: {
  title: string;
  hint: string;
  columns: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <Card>
      <CardHeader>
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
        <CardDescription id={`${id}-hint`}>{hint}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-title`}
          aria-describedby={`${id}-hint`}
          className={cn('grid gap-3', columns)}
        >
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

/** Light or dark, colour theme, typeface and text size (Q50): browser preferences, applied as they are picked. */
export function AppearanceSettings() {
  const { t } = useTranslation();
  const prefs = usePreferences();
  // Palette cards draw the screen as it is now, so a card never advertises a mode the user is not looking at.
  const onScreen = resolveTheme(prefs.theme);

  return (
    <>
      <OptionGroup
        title={t('settings.appearance.modeTitle')}
        hint={t('settings.appearance.modeHint')}
        columns="sm:grid-cols-3"
      >
        {THEMES.map((theme: Theme) => {
          const Icon = MODE_ICONS[theme];
          return (
            <OptionCard
              key={theme}
              name="theme"
              value={theme}
              selected={prefs.theme === theme}
              onSelect={() => setPreferences({ theme })}
              title={t(`settings.appearance.modes.${theme}`)}
              description={t(`settings.appearance.modeDescriptions.${theme}`)}
              icon={<Icon className="size-4" />}
            >
              <ThemePreview mode={theme} palette={prefs.palette} />
            </OptionCard>
          );
        })}
      </OptionGroup>

      <OptionGroup
        title={t('settings.appearance.paletteTitle')}
        hint={t('settings.appearance.paletteHint')}
        columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      >
        {PALETTES.map((palette: Palette) => (
          <OptionCard
            key={palette}
            name="palette"
            value={palette}
            selected={prefs.palette === palette}
            onSelect={() => setPreferences({ palette })}
            title={t(`settings.appearance.palettes.${palette}`)}
            description={t(`settings.appearance.paletteDescriptions.${palette}`)}
          >
            <ThemePreview mode={onScreen} palette={palette} />
          </OptionCard>
        ))}
      </OptionGroup>

      <OptionGroup
        title={t('settings.appearance.fontTitle')}
        hint={t('settings.appearance.fontHint')}
        columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-3"
      >
        {FONT_FAMILIES.map((font: FontFamily) => (
          <OptionCard
            key={font}
            name="font"
            value={font}
            selected={prefs.font === font}
            onSelect={() => setPreferences({ font })}
            title={t(`settings.appearance.fonts.${font}`)}
            description={t(`settings.appearance.fontDescriptions.${font}`)}
          >
            <FontSpecimen font={font} />
          </OptionCard>
        ))}
      </OptionGroup>

      <OptionGroup
        title={t('settings.appearance.sizeTitle')}
        hint={t('settings.appearance.sizeHint')}
        columns="grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
      >
        {FONT_SIZES.map((size: FontSize) => (
          <OptionCard
            key={size}
            name="fontSize"
            value={size}
            selected={prefs.fontSize === size}
            onSelect={() => setPreferences({ fontSize: size })}
            title={t(`settings.appearance.sizes.${size}`)}
          >
            <TextSizeSpecimen
              size={size}
              label={t('settings.appearance.sizeSampleLabel')}
              value={t('settings.appearance.sizeSample')}
            />
          </OptionCard>
        ))}
      </OptionGroup>
    </>
  );
}
