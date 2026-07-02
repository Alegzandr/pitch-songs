import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Volume2, Volume1, VolumeX } from 'lucide-react';
import { Slider } from '@/components/ui/slider';
import { useDoubleClickReset } from '@/hooks/useDoubleClickReset';
import { AUDIO_PROCESSING } from '@/constants';

interface VolumeControlProps {
  volume: number;
  onVolumeChange: (volume: number) => void;
  disabled?: boolean;
  className?: string;
}

const WHEEL_STEP = 0.05;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Compact transport volume: an icon that reflects the level plus a short slider.
 * The whole control is a wheel target, so scrolling anywhere over it (a generous
 * hit area, not just the thin track) nudges the volume without scrolling the page.
 */
export const VolumeControl = memo(function VolumeControl({ volume, onVolumeChange, disabled, className = '' }: VolumeControlProps) {
  const { t } = useTranslation();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const handleDoubleClickReset = useDoubleClickReset(
    () => onVolumeChange(AUDIO_PROCESSING.DEFAULT_VOLUME),
    !disabled,
  );

  // Keep the latest props in refs so the native wheel listener is attached once.
  const volumeRef = useRef(volume);
  const changeRef = useRef(onVolumeChange);
  const disabledRef = useRef(disabled);

  // Remember the pre-mute level so clicking the icon can restore it on unmute.
  const preMuteVolumeRef = useRef(volume || AUDIO_PROCESSING.DEFAULT_VOLUME);

  const toggleMute = () => {
    if (disabled) return;
    if (volume === 0) {
      onVolumeChange(preMuteVolumeRef.current || AUDIO_PROCESSING.DEFAULT_VOLUME);
    } else {
      preMuteVolumeRef.current = volume;
      onVolumeChange(0);
    }
  };

  useEffect(() => {
    volumeRef.current = volume;
    changeRef.current = onVolumeChange;
    disabledRef.current = disabled;
  }, [volume, onVolumeChange, disabled]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;

    // Native listener with passive:false so we can stop the page from scrolling.
    const handleWheel = (event: WheelEvent) => {
      if (disabledRef.current) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      const next = round2(clamp01(volumeRef.current + direction * WHEEL_STEP));
      if (next !== volumeRef.current) changeRef.current(next);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const muted = volume === 0;
  const VolumeIcon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume * 100);

  return (
    <div
      ref={wrapperRef}
      className={`flex items-center gap-2 px-2 py-2 rounded-full hover:bg-[rgba(var(--color-border),0.3)] transition-colors ${className}`}
      title={`${t('playback.volume')}: ${percent}%`}
    >
      <button
        type="button"
        onClick={toggleMute}
        disabled={disabled}
        aria-label={muted ? t('playback.unmute') : t('playback.mute')}
        title={muted ? t('playback.unmute') : t('playback.mute')}
        className="shrink-0 flex items-center justify-center rounded-full text-[rgb(var(--color-text-secondary))] hover:text-[rgb(var(--color-text))] transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--color-accent))]"
      >
        <VolumeIcon className="w-4 h-4" aria-hidden="true" />
      </button>
      <Slider
        min={0}
        max={1}
        step={0.01}
        value={volume}
        onValueChange={(v) => onVolumeChange(round2(v))}
        onClick={handleDoubleClickReset}
        disabled={disabled}
        aria-label={`${t('playback.volume')}: ${percent}%`}
        title={t('effects.resetHint')}
        className="w-20 sm:w-24"
      />
    </div>
  );
});
