import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown } from 'lucide-react';
import { useMood } from '../contexts/MoodContext';
import { MOODS, MOOD_ORDER } from '../contexts/moods';
import type { MoodId } from '../contexts/moods';
import { Card } from './ui/card';
import { BeatToggle } from './BeatToggle';
import { ScrollFade } from './ScrollFade';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { cn } from '@/lib/utils';

/**
 * The workspace mood rail - an inline mood picker beside the waveform. Each mood
 * is a palette + an animated background over the same HUD, so switching it is the
 * fastest way to re-skin the whole atmosphere mid-listen. The featured mood reads
 * out at the top in a dropdown that opens the full mood gallery (every mood),
 * and the moods you've reached for recently sit one tap away below. This lifts
 * theming out of a buried menu and makes it a first-class, always-visible control.
 */

/** A small live swatch painted with the mood's own scene gradient. */
function Swatch({ id, className }: { id: MoodId; className?: string }) {
  return (
    <span
      className={cn('block rounded-lg ring-1 ring-inset ring-[rgba(var(--hud-line),0.3)]', className)}
      style={{ background: MOODS[id].preview }}
      aria-hidden="true"
    />
  );
}

/**
 * The Mood chip + gallery - the trigger reads out the active atmosphere; opening
 * it lifts the exhaustive mood gallery into a centred modal. A modal (not an
 * inline popover) is deliberate: the rail and its card are translucent, so a
 * translucent dropdown stacked over them turned text illegible - transparent on
 * transparent. The dialog's opaque overlay severs the gallery from the backdrop
 * and gives every scene preview room to breathe.
 */
function MoodGallery() {
  const { t } = useTranslation();
  const { mood, setMood } = useMood();
  const [open, setOpen] = useState(false);
  const activeName = t(`settings.mood.${MOODS[mood].labelKey}`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={open}
          className="ios-button group flex w-full items-center gap-3 rounded-2xl border border-[rgba(var(--color-border),0.7)] bg-[rgba(var(--color-surface),0.45)] px-3 py-2.5 text-left outline-none hover:border-[rgba(var(--color-accent),0.55)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-background))]"
        >
          <Swatch id={mood} className="h-8 w-8 shrink-0" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[rgb(var(--color-text))]">
              {activeName}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-[rgb(var(--color-text-secondary))] transition-transform',
              open && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </DialogTrigger>

      <DialogContent closeLabel={t('settings.close')}>
        <DialogHeader>
          <DialogTitle>{t('studio.allMoods')}</DialogTitle>
          <DialogDescription>{t('settings.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[64vh] overflow-y-auto pr-1 -mr-1">
          <div className="grid grid-cols-2 gap-2.5">
            {MOOD_ORDER.map((id) => {
              const moodDef = MOODS[id];
              const Icon = moodDef.icon;
              const active = mood === id;
              const label = t(`settings.mood.${moodDef.labelKey}`);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={active}
                  aria-label={label}
                  onClick={() => {
                    setMood(id);
                    setOpen(false);
                  }}
                  className={cn(
                    'group ios-button relative overflow-hidden rounded-2xl border text-left outline-none',
                    'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-background))]',
                    active
                      ? 'border-[rgba(var(--color-accent),0.7)] shadow-[0_12px_34px_-22px_rgba(var(--color-accent),0.95)]'
                      : 'border-[rgba(var(--color-border),0.7)] hover:border-[rgba(var(--color-accent),0.5)]'
                  )}
                >
                  {/* Live preview swatch - the mood's own scene/backdrop colours */}
                  <span className="block h-14 w-full" style={{ background: moodDef.preview }} aria-hidden="true" />
                  <span className="flex items-center justify-between gap-2 px-3 py-2 bg-[rgba(var(--color-surface),0.6)]">
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon
                        className={cn(
                          'w-4 h-4 shrink-0',
                          active ? 'text-[rgb(var(--color-accent-text))]' : 'text-[rgb(var(--color-text-secondary))]'
                        )}
                        aria-hidden="true"
                      />
                      <span className="text-sm font-semibold truncate text-[rgb(var(--color-text))]">{label}</span>
                    </span>
                    {active && <Check className="w-4 h-4 shrink-0 text-[rgb(var(--color-accent-text))]" aria-hidden="true" />}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export const MoodRail = memo(function MoodRail() {
  const { t } = useTranslation();
  const { mood, setMood, recentMoods, showBackdrop, toggleBackdrop } = useMood();

  // The featured chip already names the active mood; repeating it in the recents
  // list right below would be pure redundancy. Recents = the moods you can go
  // BACK to, so the active one is filtered out.
  const returnableMoods = recentMoods
    .filter((id) => id !== mood)
    .map((id) => ({ id, label: t(`settings.mood.${MOODS[id].labelKey}`) }))
    // Stable alphabetical order so switching moods doesn't reshuffle the
    // rail under your finger - only membership changes, never position.
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <Card asChild className="hud-frame p-4 sm:p-5 audio-drift-b max-h-[var(--col-max-h,100dvh)] flex flex-col">
      <aside aria-label={t('studio.moods')}>
        {/* Fixed frame window: the panel's glow + brackets hold still while the rail
           contents scroll INSIDE it, so the scrollbar sits within the panel, not out
           at the column edge. Capped to the space between the top/bottom rails, with
           an edge dissolve (ScrollFade) cueing there's more when it overflows. */}
        <ScrollFade className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain -mr-2 pr-2 sm:-mr-3 sm:pr-3">
        {/* Mood - the featured, currently-playing atmosphere. The dropdown opens
            the full gallery of every mood. */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 min-h-7">
            <span className="hud-readout truncate">{t('studio.mood')}</span>
          </div>
          <MoodGallery />
        </div>

        {/* Backdrop image - lets you drop the photo behind the HUD while keeping
            the living haze, aurora and particles. A single preference across moods. */}
        <BeatToggle
          label={t('studio.backdrop')}
          description={t('studio.backdropHint')}
          // In short-height mode the console shrinks and scrolls; drop the hint
          // line so the toggle stays compact and readable instead of getting
          // clipped under the scroll fade. Toggled by `.consoles-short` on <main>
          // (App.tsx), the same measurement that reflows the centre - so both
          // switch together, off one threshold.
          descriptionClassName="console-hint"
          pressed={showBackdrop}
          onToggle={toggleBackdrop}
        />

        {/* Recently used - quick one-tap return to the moods you've been cycling.
           Hidden until there is somewhere to return to. */}
        {returnableMoods.length > 0 && (
          <div className="space-y-2">
            <span className="hud-readout block">{t('studio.recentMoods')}</span>
            <ul className="space-y-1.5">
              {returnableMoods.map(({ id, label }) => {
                const Icon = MOODS[id].icon;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setMood(id)}
                      className="ios-button flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-2 text-left outline-none hover:border-[rgba(var(--color-border),0.6)] hover:bg-[rgba(var(--color-surface),0.5)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-background))]"
                    >
                      <Swatch id={id} className="h-7 w-7 shrink-0" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-[rgb(var(--color-text))]">
                        {label}
                      </span>
                      <Icon className="h-4 w-4 shrink-0 text-[rgb(var(--color-text-secondary))]" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        </ScrollFade>
      </aside>
    </Card>
  );
});
