import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useScrubber } from '../hooks/useScrubber';
import { formatClock } from '../utils/formatters';
import { DurationToggle } from './DurationToggle';
import type { PlaybackClock } from '../utils/playbackClock';

interface TransportTimelineProps {
  /** Playhead position source (effective/output time), read outside React. */
  clock: PlaybackClock;
  duration: number;
  onSeek: (time: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * Classic transport seekbar: elapsed time, a thin scrubbable track with a draggable
 * playhead, and the total duration. The track sits inside a tall transparent hit area
 * so it's easy to grab without looking like a thick bar.
 *
 * The position arrives through the playback clock (an external store), not props:
 * each tick writes the fill/thumb styles straight to the DOM, and React only
 * re-renders when the displayed whole second changes - so playback never
 * re-renders this component per frame.
 */
export function TransportTimeline({
  clock,
  duration,
  onSeek,
  disabled,
  className = '',
}: TransportTimelineProps) {
  const { t } = useTranslation();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const fillRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);

  // Whole seconds drive the clock texts + aria value - the only React re-render.
  const second = useSyncExternalStore(clock.subscribe, () => Math.floor(clock.get()));

  const applyProgress = useCallback((ratio: number) => {
    const pct = `${(Math.min(1, Math.max(0, ratio)) * 100).toFixed(3)}%`;
    if (fillRef.current) fillRef.current.style.width = pct;
    if (thumbRef.current) thumbRef.current.style.left = pct;
  }, []);

  const syncToClock = useCallback(() => {
    applyProgress(duration ? clock.get() / duration : 0);
  }, [applyProgress, clock, duration]);

  // The scrub drag/commit lifecycle and the ±5s keyboard seeks are shared with
  // the waveform instrument (useScrubber); here the visual playhead is the
  // fill/thumb styles, written straight to the DOM.
  const { draggingRef, handlePointerDown, handlePointerMove, endDrag, handleKeyDown } = useScrubber({
    duration,
    onSeek,
    surfaceRef: trackRef,
    getTime: () => clock.get(),
    disabled,
    onDragVisual: applyProgress,
    onDragEnd: syncToClock,
  });

  // Follow the clock without re-rendering; while scrubbing the pointer handlers
  // own the fill. Layout effect so a (re)mount paints the real position before
  // the first frame instead of flashing 0%.
  useLayoutEffect(() => {
    syncToClock();
    return clock.subscribe(() => {
      if (!draggingRef.current) syncToClock();
    });
  }, [clock, syncToClock, draggingRef]);

  return (
    <div className={`flex items-center gap-3 min-w-0 ${className}`}>
      <span className="text-xs font-medium tabular-nums text-[rgb(var(--color-text-secondary))] w-10 text-right shrink-0">
        {formatClock(second)}
      </span>

      {/* Tall transparent hit area around a thin visible track */}
      <div
        ref={trackRef}
        className={`group relative flex-1 min-w-0 h-6 flex items-center touch-none select-none ${
          disabled ? 'cursor-default opacity-50' : 'cursor-pointer'
        }`}
        role="slider"
        aria-label={t('waveform.scrub')}
        aria-valuemin={0}
        aria-valuemax={Math.round(duration) || 0}
        aria-valuenow={second}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={handleKeyDown}
      >
        {/* Faint HUD graduations above the track */}
        <div className="hud-ruler pointer-events-none absolute inset-x-0 top-0 opacity-30" aria-hidden="true" />

        <div className="relative w-full h-1.5 rounded-full bg-[rgba(var(--color-border),0.55)] overflow-hidden">
          <div
            ref={fillRef}
            className="absolute inset-y-0 left-0 rounded-full bg-[rgb(var(--color-accent))]"
            aria-hidden="true"
          />
        </div>
        {/* Playhead thumb: appears on hover/focus, always visible while scrubbing */}
        <div
          ref={thumbRef}
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-[0_2px_6px_-1px_rgba(0,0,0,0.35),0_0_0_4px_rgba(var(--color-accent),0.25)] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity"
          aria-hidden="true"
        />
      </div>

      <DurationToggle
        duration={duration}
        current={second}
        className="text-xs font-medium tabular-nums text-[rgb(var(--color-text-secondary))] w-12 text-left shrink-0 transition-colors hover:text-[rgb(var(--color-text))] focus-visible:text-[rgb(var(--color-text))] cursor-pointer"
      />
    </div>
  );
}
