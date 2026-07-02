import { memo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { IDLE_FRAME_MS } from './scenes/frameClock';
import { createMoodPaletteCache } from './scenes/paletteReader';
import { prefersReducedMotion } from './scenes/motion';

interface SpectrumMeterProps {
  /** Returns the live analyser node, or null while stopped. */
  getAnalyser: () => AnalyserNode | null;
  isPlaying: boolean;
  className?: string;
}

const BAR_COUNT = 28;
const BAR_GAP = 2; // device-independent px between bars

/**
 * A compact live spectrum read off the playback analyser - the little instrument
 * that makes the transport feel alive without competing with the waveform. It
 * draws real frequency data while a track plays; when idle (or under
 * prefers-reduced-motion) it settles to a calm, static baseline rather than
 * faking motion.
 */
export const SpectrumMeter = memo(function SpectrumMeter({ getAnalyser, isPlaying, className }: SpectrumMeterProps) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = prefersReducedMotion();

    let raf = 0;
    let freq: Uint8Array<ArrayBuffer> | null = null;
    // Smoothed bar heights (0..1) so idle decay and motion read softly.
    const levels = new Array(BAR_COUNT).fill(0.12);

    const resolve = (name: string, fallback: string) => {
      const v = getComputedStyle(canvas).getPropertyValue(name).trim();
      return v ? `rgb(${v})` : fallback;
    };

    // Idle-throttle clock.
    let last = 0;
    // Cached palette + gradient; the mood-palette cache re-resolves only when the
    // mood changes or cross-fades, and the gradient object is reused otherwise.
    let accent = '';
    let ambient = '';
    let grad: CanvasGradient | null = null;
    let gradH = -1;
    const palette = createMoodPaletteCache(() => {
      accent = resolve('--color-accent', 'rgb(167,139,250)');
      ambient = resolve('--color-ambient', 'rgb(56,224,232)');
      grad = null;
    });

    const draw = (now: number) => {
      // Throttle ONLY the idle travelling-wave (audio loaded but paused) to ~30fps.
      // The live spectrum and the reduced-motion settle path keep their cadence.
      const liveNow = isPlaying && !!getAnalyser();
      if (!liveNow && !reduceMotion && now - last < IDLE_FRAME_MS) {
        raf = requestAnimationFrame(draw);
        return;
      }
      last = now;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;
      if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const analyser = getAnalyser();
      if (analyser && isPlaying) {
        if (!freq || freq.length !== analyser.frequencyBinCount) {
          freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
        }
        analyser.getByteFrequencyData(freq);
        // Map the (mostly low-end) spectrum onto our bars with a gentle log-ish
        // spread so mids/highs aren't crushed into the last few bars.
        const usable = Math.floor(freq.length * 0.7);
        for (let i = 0; i < BAR_COUNT; i++) {
          const idx = Math.floor(((i + 1) / BAR_COUNT) ** 1.6 * (usable - 1));
          const target = (freq[idx] ?? 0) / 255;
          levels[i] += (target - levels[i]) * 0.35;
        }
      } else if (reduceMotion) {
        // Reduced motion: settle to a calm static baseline (no faked motion).
        for (let i = 0; i < BAR_COUNT; i++) {
          levels[i] += (0.12 - levels[i]) * 0.15;
        }
      } else {
        // Idle telemetry: a slow travelling wave so the instrument stays alive
        // between tracks (the "scrolling" meter - tied to nothing, just breathing).
        const tsec = now * 0.001;
        for (let i = 0; i < BAR_COUNT; i++) {
          const wave = 0.16 + 0.14 * (0.5 + 0.5 * Math.sin(tsec * 1.7 - i * 0.5));
          levels[i] += (wave - levels[i]) * 0.2;
        }
      }

      palette.ensure();
      if (!grad || gradH !== cssH) {
        grad = ctx.createLinearGradient(0, cssH, 0, 0);
        grad.addColorStop(0, ambient);
        grad.addColorStop(1, accent);
        gradH = cssH;
      }
      ctx.fillStyle = grad;

      const barW = (cssW - BAR_GAP * (BAR_COUNT - 1)) / BAR_COUNT;
      const radius = Math.min(barW / 2, 2);
      for (let i = 0; i < BAR_COUNT; i++) {
        const h = Math.max(2, levels[i] * cssH);
        const x = i * (barW + BAR_GAP);
        const y = cssH - h;
        ctx.beginPath();
        ctx.roundRect(x, y, barW, h, radius);
        ctx.fill();
      }

      // No-reduce: always keep animating (live spectrum or the idle wave).
      // Reduced motion: run only until the bars settle to the static baseline.
      if (!reduceMotion) {
        raf = requestAnimationFrame(draw);
      } else {
        const settling = levels.some((l) => Math.abs(l - 0.12) > 0.01);
        if (settling) raf = requestAnimationFrame(draw);
      }
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser, isPlaying]);

  return (
    <canvas
      ref={canvasRef}
      role="img"
      aria-label={t('studio.levels')}
      className={className}
    />
  );
});
