import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { Music } from 'lucide-react';
import { WAVEFORM, AUDIO_PROCESSING } from '../constants';
import { useScrubber } from '../hooks/useScrubber';
import { useWaveform } from '../hooks/useWaveform';
import { DurationToggle } from './DurationToggle';
import { useMood } from '../contexts/MoodContext';
import { shapeEnvelope } from '../utils/waveform';
import { formatClock } from '../utils/formatters';
import { createWaveInstrument, type WaveInstrument } from './waveInstrument';
import { prefersReducedMotion } from './scenes/motion';
import { IDLE_FRAME_MS } from './scenes/frameClock';
import type { AudioProcessingOptions } from '../utils/audioProcessor';
import type { PlaybackClock } from '../utils/playbackClock';

interface WaveformTimelineProps {
  buffer?: AudioBuffer | null;
  duration: number;
  /** Playhead position source (effective/output time), read outside React. */
  clock: PlaybackClock;
  isPlaying: boolean;
  onSeek: (time: number) => void;
  options?: AudioProcessingOptions | null;
  /** Live playback analyser - feeds the instrument's spectral overlays. */
  getAnalyser?: () => AnalyserNode | null;
  /** Auto-detected tempo (rounded BPM) of the track, shown as a HUD readout. */
  detectedBpm?: number | null;
  /** Auto-detected meter (3 or 4 beats per bar), paired with the BPM readout. */
  detectedMeter?: 3 | 4 | null;
}

/**
 * The centre instrument. The track is drawn by the Canvas wave instrument
 * (`waveInstrument.ts`) as a continuous ribbon of light; this component owns
 * everything around the paint: the HUD plate, the clock, seek + keyboard
 * interaction, the DAW-style stretch/scroll behaviour, and the render loop
 * cadence (every display frame while playing, throttled when idle, one paint
 * per change under reduced motion).
 *
 * The playhead arrives through the playback clock (an external store): the
 * paint loop and the scroll auto-follow read it from a ref on their own
 * schedule, and React only re-renders when the displayed whole second changes.
 */
export const WaveformTimeline = memo(function WaveformTimeline({
  buffer,
  duration,
  clock,
  isPlaying,
  onSeek,
  options,
  getAnalyser,
  detectedBpm,
  detectedMeter,
}: WaveformTimelineProps) {
  const { t } = useTranslation();
  const { mood } = useMood();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // `dragRatio` drives the on-screen playhead during a drag; the scrub state
  // machine itself (visual-only drag, commit on release) lives in useScrubber.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  // Latest pointer X during a scrub, so the edge auto-scroll loop can recompute
  // the ratio as the content slides underneath a stationary cursor.
  const lastClientXRef = useRef(0);
  // Edge auto-scroll: a rAF that pans the viewport while the pointer rests in a
  // left/right edge zone during a scrub, letting one drag reach the whole clip.
  const edgeRafRef = useRef(0);
  const edgeVelRef = useRef(0);
  // Grab-to-pan (middle / right button): moves the view without seeking.
  const panningRef = useRef(false);
  const panStartRef = useRef({ x: 0, scrollLeft: 0 });

  const reduceMotion = useMemo(prefersReducedMotion, []);

  // DAW-style zoom: a constant pixels-per-second, so the content width and the bar count
  // both scale by the stretch factor (1 / rate) and density stays the same. Slowing down
  // makes the clip physically wider (it overflows and scrolls); speeding up makes it
  // shorter, so it sits narrower against the left, time-0 anchored like a real timeline.
  const rate = options?.speedMultiplier || 1;
  const stretch = rate > 0 ? 1 / rate : 1;
  const widthPercent = stretch * 100;
  const barCount = Math.max(WAVEFORM.MIN_BAR_COUNT, Math.round(WAVEFORM.BAR_COUNT * stretch));

  // Tempo readout: the grid rides the playback rate, so the chip reports the tempo
  // actually heard (detected BPM × rate) and appends the untouched original in
  // parentheses whenever the speed moves it off that value. Meter is rate-invariant.
  const tempoLabel = useMemo(() => {
    if (detectedBpm == null) return null;
    const meter = `${detectedMeter ?? 4}/4`;
    const effective = Math.round(detectedBpm * rate);
    return effective === detectedBpm
      ? t('waveform.tempo', { bpm: detectedBpm, meter })
      : t('waveform.tempoScaled', { bpm: effective, meter, original: detectedBpm });
  }, [detectedBpm, detectedMeter, rate, t]);

  const { bars: sourceBars } = useWaveform({ buffer, bars: barCount });
  // Preview the active effect by reshaping the source envelope in step with the sound.
  const bars = useMemo(() => shapeEnvelope(sourceBars, options), [sourceBars, options]);

  // Whole seconds for the clock text and aria value - the only thing playback
  // re-renders. The continuous playhead lives in clockRatioRef below.
  const second = useSyncExternalStore(clock.subscribe, () => Math.floor(clock.get()));

  // The instrument's per-effect signatures (weave, afterglow, core pulse).
  const fx = useMemo(
    () => ({
      reverb: options?.reverbAmount ?? 0,
      is8D: options?.audio8D ?? false,
      rotation: options?.rotationSpeed ?? 0,
      bass: options?.bassBoost ? (options.bassBoostIntensity ?? 0) : 0,
      muffle: options?.bassBoost ? (options.bassUnderwater ?? 0) : 0,
    }),
    [options]
  );

  // Latest inputs for the paint loop, refreshed after every render (the loop
  // itself never re-subscribes on prop churn - it just reads the ref). The
  // playhead ratio is deliberately NOT here: it ticks 60×/s through the clock
  // subscription, not through renders.
  const frameRef = useRef({ env: bars, isPlaying, reducedMotion: reduceMotion, fx });
  useEffect(() => {
    frameRef.current = { env: bars, isPlaying, reducedMotion: reduceMotion, fx };
  });

  // The analyser prop is stable in practice, but route it through a ref so the
  // instrument (created once) always reads the current one.
  const getAnalyserRef = useRef(getAnalyser);
  useEffect(() => {
    getAnalyserRef.current = getAnalyser;
  }, [getAnalyser]);

  const instrumentRef = useRef<WaveInstrument | null>(null);

  // The scrub drag/commit lifecycle and the ±5s keyboard seeks are shared with
  // the transport seekbar (useScrubber); this component layers edge auto-scroll
  // and grab-to-pan on top through the hook's callbacks and primitives.
  const {
    draggingRef,
    dragRatioRef,
    ratioFromPointer,
    updateDragRatio,
    handlePointerDown: beginScrub,
    handlePointerMove: moveScrub,
    endDrag: endScrub,
    handleKeyDown,
  } = useScrubber({
    duration,
    onSeek,
    surfaceRef: contentRef,
    getTime: () => clock.get(),
    onDragVisual: (r) => setDragRatio(r),
    onDragStart: (event) => {
      lastClientXRef.current = event.clientX;
    },
    onDragMove: (event) => {
      lastClientXRef.current = event.clientX;
      // A cursor parked at the edge keeps the clip scrolling so one drag can reach
      // positions beyond the current viewport.
      updateEdgeScroll(event.clientX);
    },
    onDragEnd: () => {
      stopEdgeScroll();
      setDragRatio(null);
    },
  });

  const stopEdgeScroll = () => {
    if (edgeRafRef.current) cancelAnimationFrame(edgeRafRef.current);
    edgeRafRef.current = 0;
    edgeVelRef.current = 0;
  };

  // The edge-scroll tick: pan the viewport by the current velocity, then re-derive
  // the scrub ratio from the last pointer X (the content moved under the cursor).
  const edgeTick = () => {
    edgeRafRef.current = requestAnimationFrame(edgeTick);
    const viewport = viewportRef.current;
    if (!viewport || edgeVelRef.current === 0) return;
    viewport.scrollLeft += edgeVelRef.current;
    const r = ratioFromPointer(lastClientXRef.current);
    if (r !== null) updateDragRatio(r);
  };

  // Arm/disarm edge auto-scroll based on how deep the pointer sits in either edge
  // zone of the viewport - only meaningful once the clip actually overflows.
  const updateEdgeScroll = (clientX: number) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const overflow = viewport.scrollWidth - viewport.clientWidth;
    if (overflow <= 1) {
      stopEdgeScroll();
      return;
    }
    const rect = viewport.getBoundingClientRect();
    const zone = WAVEFORM.EDGE_SCROLL_ZONE_PX;
    let vel = 0;
    if (clientX < rect.left + zone) {
      vel = -((rect.left + zone - clientX) / zone) * WAVEFORM.EDGE_SCROLL_MAX_SPEED;
    } else if (clientX > rect.right - zone) {
      vel = ((clientX - (rect.right - zone)) / zone) * WAVEFORM.EDGE_SCROLL_MAX_SPEED;
    }
    edgeVelRef.current = vel;
    if (vel !== 0 && !edgeRafRef.current) edgeRafRef.current = requestAnimationFrame(edgeTick);
    else if (vel === 0) stopEdgeScroll();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    // Middle or right button starts a grab-to-pan of the view, leaving the
    // playhead untouched. Primary button (or touch/pen) scrubs.
    if (event.button === 1 || event.button === 2) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      panningRef.current = true;
      panStartRef.current = { x: event.clientX, scrollLeft: viewport.scrollLeft };
      try {
        contentRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // setPointerCapture is unavailable in some environments; panning still works.
      }
      if (contentRef.current) contentRef.current.style.cursor = 'grabbing';
      event.preventDefault();
      return;
    }
    if (event.button !== 0) return;
    beginScrub(event);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panningRef.current) {
      const viewport = viewportRef.current;
      if (!viewport) return;
      // Follow the cursor: dragging right pulls earlier content into view.
      viewport.scrollLeft = panStartRef.current.scrollLeft - (event.clientX - panStartRef.current.x);
      return;
    }
    moveScrub(event);
  };

  const endDrag = () => {
    if (panningRef.current) {
      panningRef.current = false;
      if (contentRef.current) contentRef.current.style.cursor = '';
      return;
    }
    endScrub();
  };

  // Auto-follow the playhead through an overflowing (stretched) waveform without a
  // forced reflow each frame: layout metrics are cached and refreshed only when the
  // content actually resizes (ResizeObserver), not read on the per-frame tick.
  const metricsRef = useRef({ scrollWidth: 0, clientWidth: 0 });
  // Continuous playhead ratio, written by the clock subscription (not renders).
  const clockRatioRef = useRef(0);
  // Bumped on real size changes so the reduced-motion paint path repaints too.
  const [resizeTick, setResizeTick] = useState(0);

  const measure = useCallback(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;
    metricsRef.current = { scrollWidth: content.scrollWidth, clientWidth: viewport.clientWidth };
  }, []);

  const follow = useCallback(() => {
    const viewport = viewportRef.current;
    // Never yank the view back to the playhead while the user is scrubbing or
    // manually panning it.
    if (!viewport || draggingRef.current || panningRef.current) return;
    const { scrollWidth, clientWidth } = metricsRef.current;
    const overflow = scrollWidth - clientWidth;
    if (overflow <= 1) return;
    const playheadPx = clockRatioRef.current * scrollWidth;
    const target = Math.min(Math.max(playheadPx - clientWidth / 2, 0), overflow);
    viewport.scrollLeft = target;
  }, [draggingRef]);

  // One paint with the freshest layout numbers - the whole draw path in one place.
  const drawNow = useCallback((now?: number) => {
    const viewport = viewportRef.current;
    const instrument = instrumentRef.current;
    if (!viewport || !instrument) return;
    instrument.draw(
      {
        ...frameRef.current,
        // During a drag the playhead follows the pointer; otherwise the clock.
        ratio: draggingRef.current ? dragRatioRef.current : clockRatioRef.current,
        contentWidth: metricsRef.current.scrollWidth || viewport.clientWidth,
        scrollLeft: viewport.scrollLeft,
      },
      now ?? performance.now()
    );
  }, [draggingRef, dragRatioRef]);

  // Mount the instrument once per canvas lifetime.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const instrument = createWaveInstrument(canvas, () => getAnalyserRef.current?.() ?? null);
    instrumentRef.current = instrument;
    return () => {
      instrument?.destroy();
      instrumentRef.current = null;
    };
  }, []);

  // Stop any in-flight edge auto-scroll when the component unmounts.
  useEffect(() => stopEdgeScroll, []);

  // Refresh cached metrics on real size changes; the per-frame effect just consumes
  // them. ResizeObserver is feature-detected (absent under jsdom).
  useEffect(() => {
    measure();
    follow();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      measure();
      follow();
      setResizeTick((n) => n + 1);
    });
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (content) ro.observe(content);
    if (viewport) ro.observe(viewport);
    return () => ro.disconnect();
  }, [measure, follow, stretch, bars.length]);

  // Follow the clock outside React: each tick refreshes the playhead ratio and
  // auto-follows the scroll (cached metrics, no layout reads). Under reduced
  // motion - where there is no paint loop - it also repaints the static frame,
  // matching the old per-change cadence without any per-frame re-render.
  useEffect(() => {
    const update = () => {
      clockRatioRef.current = duration ? Math.min(1, Math.max(0, clock.get() / duration)) : 0;
      follow();
      if (reduceMotion) drawNow();
    };
    update();
    return clock.subscribe(update);
  }, [clock, duration, follow, reduceMotion, drawNow]);

  // Re-anchor the auto-follow when the zoom/stretch or the play state changes.
  useEffect(() => {
    follow();
  }, [stretch, isPlaying, follow]);

  // The paint loop. rAF runs at the display's own refresh rate; when the
  // instrument is idle (paused, embers gone) it relaxes to ~30fps so a resting
  // cockpit costs almost nothing. Under reduced motion there is NO loop at all -
  // the effect below paints once per actual change.
  useEffect(() => {
    if (reduceMotion) return;
    let raf = 0;
    let last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const f = frameRef.current;
      const idle = !f.isPlaying && !instrumentRef.current?.hasLiveOverlays();
      if (idle && now - last < IDLE_FRAME_MS) return;
      last = now;
      drawNow(now);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion, drawNow]);

  // Reduced motion: static paints driven by real state changes (seek, effect
  // tweak, mood swap, scroll, resize) - never a free-running loop.
  useEffect(() => {
    if (!reduceMotion) return;
    drawNow();
    const viewport = viewportRef.current;
    const onScroll = () => drawNow();
    viewport?.addEventListener('scroll', onScroll, { passive: true });
    return () => viewport?.removeEventListener('scroll', onScroll);
  }, [reduceMotion, drawNow, bars, dragRatio, isPlaying, fx, mood, resizeTick]);

  return (
    <div className="relative glass hud-frame rounded-3xl p-5 sm:p-6 flex flex-col gap-5 h-full">
      {/* Slim header (now-playing status + clock) with the HUD scale tucked
          right under it, on a shared header height so it lines up with the
          control rail's header across the grid. */}
      <div className="space-y-2 shrink-0">
        <div className="flex items-center justify-between gap-3 min-h-7">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`inline-flex items-center gap-2 text-xs font-medium px-2.5 py-1 rounded-full ${
                isPlaying
                  ? 'text-[rgb(var(--color-accent-text))] bg-[rgba(var(--color-accent),0.12)]'
                  : 'text-[rgb(var(--color-text-secondary))] bg-[rgba(var(--color-border),0.35)]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  isPlaying ? 'bg-[rgb(var(--color-accent))] animate-pulse' : 'bg-[rgb(var(--color-text-secondary))]'
                }`}
                aria-hidden="true"
              />
              {isPlaying ? t('waveform.playing') : t('waveform.idle')}
            </span>
            {/* Track tempo, detected once on load (see detectTempo). Reflects the
                tempo actually heard: the base BPM scaled by the playback rate, with
                the original in parentheses when the speed shifts it. */}
            {tempoLabel != null && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium tabular-nums px-2.5 py-1 rounded-full text-[rgb(var(--color-text-secondary))] bg-[rgba(var(--color-border),0.35)]">
                <Music className="w-3 h-3 shrink-0" aria-hidden="true" />
                {tempoLabel}
              </span>
            )}
          </div>
          <p className="text-sm font-semibold tabular-nums text-[rgb(var(--color-text))]" aria-live="polite">
            {formatClock(second)}
            <span className="text-[rgb(var(--color-text-secondary))] font-normal">
              {' / '}
              <DurationToggle
                duration={duration}
                current={second}
                storageKey={AUDIO_PROCESSING.DURATION_DISPLAY_STORAGE_KEY_WAVEFORM}
                className="font-normal tabular-nums transition-colors hover:text-[rgb(var(--color-text))] focus-visible:text-[rgb(var(--color-text))] cursor-pointer"
              />
            </span>
          </p>
        </div>
        <div className="hud-ruler" aria-hidden="true" />
      </div>

      {/* The instrument stage. The canvas is viewport-sized and stays put; the
         transparent scroll layer above it carries the stretched clip (and all
         pointer interaction), and the paint translates by its scrollLeft.
         Height: a preferred 15rem (flex-basis) that the stage shrinks FROM when the
         centre column is capped on a short viewport, down to a usable floor - so the
         waveform gives up height gracefully instead of forcing the column to overflow.
         The basis is what keeps the h-full chain from collapsing on a content-sized
         card (the header/footer are shrink-0, so only the stage flexes). The canvas
         re-reads its own clientHeight each paint, so the ribbon reflows to any size. */}
      <div className="relative grow shrink basis-60 min-h-32 rounded-2xl overflow-hidden">
        <div
          className="wf-aura pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_30%_20%,rgba(var(--color-ambient),0.10),transparent_50%),radial-gradient(circle_at_80%_0%,rgba(var(--color-accent),0.08),transparent_45%)]"
          aria-hidden="true"
        />
        <canvas ref={canvasRef} className="absolute inset-0 z-10 h-full w-full" aria-hidden="true" />

        {/* Scroll viewport: transparent, above the paint; the clip pans inside it. */}
        <div
          ref={viewportRef}
          className="absolute inset-0 z-20 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {/* Scrub surface - its width grows with the stretch factor, so it can overflow. */}
          <div
            ref={contentRef}
            data-testid="waveform-timeline"
            className="relative h-full cursor-pointer touch-none select-none"
            style={{ width: `${widthPercent}%` }}
            role="slider"
            aria-label={t('waveform.scrub')}
            aria-valuemin={0}
            aria-valuemax={Math.round(duration) || 0}
            aria-valuenow={second || 0}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={handleKeyDown}
          />
        </div>
      </div>

      {/* HUD corner readouts: live status + the active speed / reverb values */}
      <div className="flex items-center justify-between shrink-0">
        <span className="hud-readout">{isPlaying ? '● Live' : '○ Standby'}</span>
        <span className="hud-readout tabular-nums">
          {rate.toFixed(2)}× · {Math.round((options?.reverbAmount ?? 0) * 100)}% RV
        </span>
      </div>
    </div>
  );
});
