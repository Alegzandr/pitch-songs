import { memo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Settings, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Select } from '@/components/ui/select';
import { useEq } from '../contexts/EqContext';
import { EQ_PRESETS, EQ_CUSTOM } from '../contexts/eqPresets';
import { AUDIO_EFFECTS } from '../constants';
import { cn } from '@/lib/utils';

const languages = [
  { code: 'en', name: 'English', flag: '🇬🇧' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' },
  { code: 'pt', name: 'Português', flag: '🇵🇹' },
  { code: 'ru', name: 'Русский', flag: '🇷🇺' },
  { code: 'zh', name: '简体中文', flag: '🇨🇳' },
  { code: 'ja', name: '日本語', flag: '🇯🇵' },
  { code: 'ko', name: '한국어', flag: '🇰🇷' },
  { code: 'hi', name: 'हिन्दी', flag: '🇮🇳' },
];

const EQ = AUDIO_EFFECTS.EQUALIZER;

interface SettingsMenuProps {
  /** Optional custom trigger; defaults to the gear icon button in the chrome.
   *  The mood rail passes its "More moods" row and Mood chip here so they open
   *  the same dialog without duplicating it. */
  trigger?: ReactNode;
}

// Memoised: it sits in the chrome next to per-interaction App state, and its
// only prop (`trigger`) is stable, so it never needs to follow App's renders.
export const SettingsMenu = memo(function SettingsMenu({ trigger }: SettingsMenuProps = {}) {
  const { i18n, t } = useTranslation();
  const { gains, presetName, setPreset, setBandGain, reset } = useEq();
  const [open, setOpen] = useState(false);

  const isCustom = presetName === EQ_CUSTOM;
  const isFlat = presetName === 'Flat';

  // Hand-tuned gains surface a leading "Custom" entry; otherwise the bank is the
  // built-in presets, each labelled by its own name.
  const presetOptions = [
    ...(isCustom ? [{ value: EQ_CUSTOM, label: t('settings.eqCustom') }] : []),
    ...EQ_PRESETS.map((preset) => ({ value: preset.name, label: preset.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <DialogTrigger asChild>
              <Button type="button" variant="glass" size="icon" aria-label={t('settings.open')}>
                <Settings className="w-5 h-5 text-[rgb(var(--color-text))]" aria-hidden="true" />
              </Button>
            </DialogTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('settings.open')}</TooltipContent>
        </Tooltip>
      )}

      <DialogContent
        closeLabel={t('settings.close')}
        // Closing the dialog returns focus to the gear trigger, which is also a
        // TooltipTrigger - that focus would pop its tooltip open. Suppress the
        // auto-focus restore so the tooltip stays closed after exiting settings.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
          <DialogDescription>{t('settings.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] overflow-y-auto pr-1 -mr-1">
          {/* Listening equalizer - shapes playback for comfort only; it is never
              baked into exports. A preset bank plus six hand-tunable bands. */}
          <section className="mb-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-[11px] uppercase tracking-wide text-[rgb(var(--color-text-secondary))]">
                {t('settings.equalizer')}
              </h3>
              {!isFlat && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={reset}
                  className="h-7 gap-1.5 px-2 text-[rgb(var(--color-text-secondary))]"
                >
                  <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="text-xs">{t('settings.eqReset')}</span>
                </Button>
              )}
            </div>

            <div className="rounded-2xl border border-[rgba(var(--color-border),0.7)] bg-[rgba(var(--color-surface),0.5)] p-3.5">
              {/* Preset picker */}
              <div className="flex items-center justify-between gap-3 mb-3.5">
                <span className="hud-readout shrink-0">{t('settings.eqPreset')}</span>
                <div className="min-w-0 flex-1 max-w-[58%]">
                  <Select
                    value={presetName}
                    onValueChange={setPreset}
                    options={presetOptions}
                    aria-label={t('settings.eqPreset')}
                  />
                </div>
              </div>

              {/* Band faders */}
              <div className="flex items-end justify-between gap-1 pt-1">
                {EQ.BANDS.map((band, i) => {
                  const value = gains[i] ?? 0;
                  const range = ((value - EQ.GAIN_MIN_DB) / (EQ.GAIN_MAX_DB - EQ.GAIN_MIN_DB)) * 100;
                  const bandLabel = `${band.label}Hz`;
                  return (
                    <div key={band.label} className="flex flex-col items-center gap-2 min-w-0">
                      <span
                        className={cn(
                          'text-[11px] font-semibold tabular-nums',
                          value === 0
                            ? 'text-[rgb(var(--color-text-secondary))]'
                            : 'text-[rgb(var(--color-accent-text))]'
                        )}
                      >
                        {value > 0 ? `+${value}` : value}
                      </span>
                      <input
                        type="range"
                        className="eq-slider"
                        min={EQ.GAIN_MIN_DB}
                        max={EQ.GAIN_MAX_DB}
                        step={EQ.GAIN_STEP_DB}
                        value={value}
                        onChange={(e) => setBandGain(i, parseFloat(e.target.value))}
                        onDoubleClick={() => setBandGain(i, 0)}
                        aria-label={t('settings.eqBand', { freq: bandLabel })}
                        aria-valuetext={`${value > 0 ? `+${value}` : value} dB`}
                        style={{ '--range': `${range}%` } as CSSProperties}
                      />
                      <span className="text-[10px] text-[rgb(var(--color-text-secondary))] truncate max-w-full">
                        {band.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="mt-3 text-[11px] leading-snug text-[rgb(var(--color-text-secondary))]">
                {t('settings.eqHint')}
              </p>
            </div>
          </section>

          {/* Language */}
          <section>
            <h3 className="text-[11px] uppercase tracking-wide text-[rgb(var(--color-text-secondary))] mb-2">
              {t('settings.language')}
            </h3>
            <div className="grid grid-cols-2 gap-2">
              {languages.map((lang) => {
                const active = i18n.language === lang.code;
                return (
                  <Button
                    key={lang.code}
                    type="button"
                    variant={active ? 'accent' : 'outline'}
                    onClick={() => i18n.changeLanguage(lang.code)}
                    className={cn(
                      'h-auto justify-between gap-2 px-3 py-2.5 rounded-2xl',
                      !active && 'text-[rgb(var(--color-text))]'
                    )}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-lg shrink-0">{lang.flag}</span>
                      <span className="text-sm font-semibold truncate">{lang.name}</span>
                    </span>
                    {active && <Check className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  </Button>
                );
              })}
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
});
