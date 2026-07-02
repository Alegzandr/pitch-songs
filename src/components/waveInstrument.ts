/**
 * The wave instrument - the centre of the cockpit, rendered as light.
 *
 * Replaces the DOM bar column with a Canvas-2D renderer that draws the loaded
 * track as one continuous ribbon of light around the instrument axis: a hot
 * core on the centreline, feathered tips, the played region burning in the
 * mood accent while the unplayed tail waits in the cool hairline hue. While a
 * track plays the instrument is ALIVE: the ribbon glows toward the playhead, a
 * spectral flame licks along the spine with the track's real FFT, kick onsets
 * fire pulses that travel back down the played region, treble lifts sparks off
 * the spine, and each effect morphs the instrument (reverb stretches the
 * afterglow, 8D weaves two stereo strands, bass boost deepens the core's
 * pulse).
 *
 * Contract with the host component:
 *  - the canvas is VIEWPORT-sized (never the stretched clip width); the host
 *    passes scrollLeft + contentWidth and we translate, so a slowed clip that
 *    overflows costs nothing extra per frame;
 *  - all coordinates are CSS px (the canvas transform absorbs devicePixelRatio);
 *  - `draw()` is safe to call at any cadence: every display frame while playing
 *    (rAF follows the monitor's refresh rate - 60, 120, 144Hz...), throttled
 *    when idle, once per change under reduced motion (no self-scheduling here -
 *    the host owns the loop, this module owns the paint). All physics and
 *    smoothing are integrated over the real frame delta, so the instrument
 *    moves at the same perceived speed on every refresh rate.
 *
 * Energy comes from two places: the calibrated, smoothed `--audio-*` variables
 * that useAudioReactivity publishes on <html> (inline-style reads - no style
 * recalc), and the raw analyser for per-bin spectrum. Under the software-GPU
 * tier every additive pass is dropped (plain fills only) so the instrument
 * stays honest on machines that already struggle.
 */

import { detectGpuTier } from './scenes/webgl/gpu';
import { frameDeltaSeconds } from './scenes/frameClock';
import { createMoodPaletteCache, readEnergyVar } from './scenes/paletteReader';

export interface InstrumentFx {
  /** reverbAmount 0..1 */
  reverb: number;
  is8D: boolean;
  /** rotationSpeed (Hz-ish, 0..~3) */
  rotation: number;
  /** bassBoostIntensity 0..1 (0 when bass boost is off) */
  bass: number;
  /** bassUnderwater 0..1 */
  muffle: number;
}

export interface InstrumentFrame {
  /** Shaped envelope, 0..1 per sample (already previews the active effect). */
  env: readonly number[];
  /** Playhead position 0..1 (drag-preview aware). */
  ratio: number;
  /** Full (stretched) clip width in CSS px. */
  contentWidth: number;
  /** Horizontal scroll offset of the clip viewport in CSS px. */
  scrollLeft: number;
  isPlaying: boolean;
  /** True under prefers-reduced-motion: static ribbons, no live overlays. */
  reducedMotion: boolean;
  fx: InstrumentFx;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  /** 0 = core-coloured spark, 1 = ambient-coloured spark. */
  hue: number;
}

interface Pulse {
  x0: number;
  born: number;
  life: number;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const VERTICAL_PAD = 14;
/** Silence still draws a filament, so the clip never visually "gaps". */
const MIN_HALF_HEIGHT = 2.5;
/** Power-on sweep: the instrument prints itself left-to-right on first data. */
const BOOT_MS = 950;
/** Hold before the sweep, so it plays once the plate's own boot fade-in has
 *  made the stage legible (see `.cockpit-boot` in index.css) - not under it. */
const BOOT_DELAY_MS = 380;
const FLAME_BINS = 22;
const FLAME_STRIP_W = 5;
const PARTICLE_CAP = 90;
const PULSE_SPEED = 380; // px/s back down the spine
const PULSE_COOLDOWN_MS = 150;

const parseTriplet = (value: string, fallback: Rgb): Rgb => {
  const m = value.split(',').map((p) => parseFloat(p));
  if (m.length < 3 || m.some((n) => Number.isNaN(n))) return fallback;
  return { r: m[0], g: m[1], b: m[2] };
};

const rgba = (c: Rgb, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

export function createWaveInstrument(
  canvas: HTMLCanvasElement,
  getAnalyser: () => AnalyserNode | null,
) {
  const ctx = canvas.getContext('2d');
  // jsdom (tests) has no 2D context - the instrument simply doesn't paint.
  if (!ctx) return null;

  const lowPower = detectGpuTier() === 'software';

  // --- palette -------------------------------------------------------------
  // Resolved from the CSS tokens once per mood (and while a mood cross-fades),
  // exactly like SpectrumMeter: getComputedStyle is a synchronous style flush,
  // so it must never run per steady-state frame.
  let accent: Rgb = { r: 255, g: 151, b: 178 };
  let core: Rgb = { r: 255, g: 252, b: 255 };
  let hairline: Rgb = { r: 148, g: 163, b: 208 };
  let ambient: Rgb = { r: 56, g: 189, b: 248 };
  let isDark = true;

  const readPalette = () => {
    const style = getComputedStyle(canvas);
    const pick = (name: string, fallback: Rgb) =>
      parseTriplet(style.getPropertyValue(name).trim(), fallback);
    accent = pick('--color-accent', accent);
    core = pick('--wf-core', core);
    hairline = pick('--hud-line', hairline);
    ambient = pick('--color-ambient', ambient);
    isDark = document.documentElement.classList.contains('dark');
    playedGrad = null;
    unplayedGrad = null;
  };

  const { ensure: ensurePalette } = createMoodPaletteCache(readPalette);

  // --- per-bin spectrum ------------------------------------------------------
  let freq: Uint8Array<ArrayBuffer> | null = null;
  const bins = new Float32Array(FLAME_BINS);

  const readSpectrum = (playing: boolean, dt: number) => {
    const analyser = playing ? getAnalyser() : null;
    if (!analyser) {
      const decay = Math.exp(-6.3 * dt);
      for (let i = 0; i < FLAME_BINS; i++) bins[i] *= decay;
      return;
    }
    if (!freq || freq.length !== analyser.frequencyBinCount) {
      freq = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    }
    analyser.getByteFrequencyData(freq);
    // Log-ish spread over the musically useful low 70% (same mapping the
    // SpectrumMeter settled on) with a soft attack so the flame breathes.
    const usable = Math.floor(freq.length * 0.7);
    const attack = 1 - Math.exp(-30 * dt);
    for (let i = 0; i < FLAME_BINS; i++) {
      const idx = Math.floor(((i + 1) / FLAME_BINS) ** 1.6 * (usable - 1));
      const target = (freq[idx] ?? 0) / 255;
      bins[i] += (target - bins[i]) * attack;
    }
  };

  // --- eased display envelope ------------------------------------------------
  // The drawn envelope chases the shaped target, so dragging an effect slider
  // MORPHS the instrument as liquid instead of snapping between shapes.
  let shown = new Float32Array(0);

  const easeEnvelope = (target: readonly number[], instant: boolean, dt: number) => {
    if (shown.length !== target.length) {
      // Resolution changed (speed step) - resample what's on screen so the
      // morph continues from the current silhouette, not from zero.
      const prev = shown;
      shown = new Float32Array(target.length);
      if (prev.length > 1) {
        for (let i = 0; i < shown.length; i++) {
          const t = (i / (shown.length - 1)) * (prev.length - 1);
          const lo = Math.floor(t);
          const hi = Math.min(prev.length - 1, lo + 1);
          shown[i] = prev[lo] + (prev[hi] - prev[lo]) * (t - lo);
        }
      }
    }
    if (instant) {
      for (let i = 0; i < target.length; i++) shown[i] = target[i];
      return;
    }
    const chase = 1 - Math.exp(-15 * dt);
    for (let i = 0; i < target.length; i++) {
      shown[i] += (target[i] - shown[i]) * chase;
    }
  };

  // --- live overlays ----------------------------------------------------------
  const particles: Particle[] = [];
  const pulses: Pulse[] = [];
  let lastPulseAt = 0;

  // Gradient caches (rebuilt on palette or height change only).
  let playedGrad: CanvasGradient | null = null;
  let unplayedGrad: CanvasGradient | null = null;
  let gradHeight = -1;

  const ensureGradients = (h: number) => {
    if (playedGrad && unplayedGrad && gradHeight === h) return;
    gradHeight = h;
    // Tips stay bright enough (0.26) that the fill visibly reaches its true
    // envelope: with faded tips the lit body reads SMALLER than the ghost's
    // crisp outline across the playhead, as if the light didn't fill the wave.
    playedGrad = ctx.createLinearGradient(0, 0, 0, h);
    playedGrad.addColorStop(0, rgba(accent, 0.26));
    playedGrad.addColorStop(0.3, rgba(accent, 0.7));
    playedGrad.addColorStop(0.5, rgba(core, 0.92));
    playedGrad.addColorStop(0.7, rgba(accent, 0.7));
    playedGrad.addColorStop(1, rgba(accent, 0.26));
    // The unplayed tail is a GHOST: a near-empty body under a fine luminous
    // edge (stroked separately), so the scene keeps breathing through it.
    unplayedGrad = ctx.createLinearGradient(0, 0, 0, h);
    unplayedGrad.addColorStop(0, rgba(hairline, 0.02));
    unplayedGrad.addColorStop(0.5, rgba(hairline, 0.13));
    unplayedGrad.addColorStop(1, rgba(hairline, 0.02));
  };

  /** Linear-interpolated envelope height (in samples space) at a content x. */
  const envAt = (x: number, contentWidth: number) => {
    const n = shown.length;
    if (n === 0 || contentWidth <= 0) return 0;
    if (n === 1) return shown[0];
    const t = Math.min(1, Math.max(0, x / contentWidth)) * (n - 1);
    const lo = Math.floor(t);
    const hi = Math.min(n - 1, lo + 1);
    return shown[lo] + (shown[hi] - shown[lo]) * (t - lo);
  };

  /** Trace the mirrored ribbon outline for samples i0..i1 (inclusive). */
  const traceRibbon = (
    i0: number,
    i1: number,
    contentWidth: number,
    mid: number,
    amp: number,
  ) => {
    const n = shown.length;
    const step = contentWidth / Math.max(1, n - 1);
    const xAt = (i: number) => i * step;
    const half = (i: number) => Math.max(MIN_HALF_HEIGHT, shown[i] * amp);

    ctx.beginPath();
    // Top edge, left → right, smoothed through segment midpoints.
    ctx.moveTo(xAt(i0), mid - half(i0));
    for (let i = i0 + 1; i <= i1; i++) {
      const xPrev = xAt(i - 1);
      const xCur = xAt(i);
      const yPrev = mid - half(i - 1);
      const yCur = mid - half(i);
      ctx.quadraticCurveTo(xPrev, yPrev, (xPrev + xCur) / 2, (yPrev + yCur) / 2);
    }
    ctx.lineTo(xAt(i1), mid - half(i1));
    // Bottom edge, right → left (mirror).
    ctx.lineTo(xAt(i1), mid + half(i1));
    for (let i = i1 - 1; i >= i0; i--) {
      const xNext = xAt(i + 1);
      const xCur = xAt(i);
      const yNext = mid + half(i + 1);
      const yCur = mid + half(i);
      ctx.quadraticCurveTo(xNext, yNext, (xNext + xCur) / 2, (yNext + yCur) / 2);
    }
    ctx.closePath();
  };

  let dpr = 1;
  let lastNow = -1;
  // -1 = waiting for the first real envelope; then the sweep timestamp.
  let bootStart = -1;
  let bootActive = false;

  const resize = (cssW: number, cssH: number) => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  const draw = (frame: InstrumentFrame, now: number) => {
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    if (!cssW || !cssH) return;
    resize(cssW, cssH);
    ensurePalette();
    ensureGradients(cssH);

    const { ratio, isPlaying, reducedMotion, fx } = frame;
    const contentWidth = Math.max(frame.contentWidth, cssW);
    const scrollLeft = frame.scrollLeft;
    // Real frame delta (clamped so a background-tab stall can't teleport the
    // physics), so speed is identical at 60, 120 or 144Hz.
    const dt = frameDeltaSeconds(now, lastNow);
    lastNow = now;
    easeEnvelope(frame.env, reducedMotion || (!isPlaying && shown.length !== frame.env.length), dt);

    // A live instrument only while actually animating: reduced motion keeps
    // the ribbons + playhead (state) and drops every decorative energy.
    const live = isPlaying && !reducedMotion;
    const level = live ? readEnergyVar('--audio-level') : 0;
    const bass = live ? readEnergyVar('--audio-bass') : 0;
    const treble = live ? readEnergyVar('--audio-treble') : 0;
    const onset = live ? readEnergyVar('--audio-pulse') : 0;
    readSpectrum(live, dt);

    const mid = cssH / 2;
    const amp = mid - VERTICAL_PAD;
    const playX = ratio * contentWidth;
    const n = shown.length;

    // Additive light only works over a dark stage; on the light workspace (and
    // the software-GPU tier) everything paints source-over at calm alphas.
    const additive = isDark && !lowPower;
    const glow = (a: number) => (additive ? a : a * 0.55);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.translate(-scrollLeft, 0);

    const visL = scrollLeft - 24;
    const visR = scrollLeft + cssW + 24;

    // Power-on: the first frame with real data starts a one-shot sweep that
    // prints the instrument left-to-right behind a scanning beam. Under
    // reduced motion the instrument is simply there - no sweep.
    if (bootStart < 0 && frame.env.some((v) => v > 0)) {
      bootStart = reducedMotion ? now - BOOT_MS : now + BOOT_DELAY_MS;
    }
    const bootT = bootStart < 0 ? 0 : Math.min(1, Math.max(0, (now - bootStart) / BOOT_MS));
    const booting = bootStart >= 0 && bootT < 1;
    const bootEase = 1 - (1 - bootT) ** 5;
    const sweepX = visL + bootEase * (cssW + 72);
    if (booting) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(visL, 0, sweepX - visL, cssH);
      ctx.clip();
    }
    if (bootStart < 0) {
      // Nothing to print yet - keep the empty stage clean.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      return;
    }

    // 1 - instrument axis: the hairline every core rides on.
    ctx.fillStyle = rgba(hairline, 0.22);
    ctx.fillRect(visL, mid - 0.5, visR - visL, 1);

    if (n > 1) {
      const step = contentWidth / (n - 1);
      const i0 = Math.max(0, Math.floor(visL / step));
      const i1 = Math.min(n - 1, Math.ceil(visR / step));

      // 2 - unplayed ribbon: cool, waiting.
      if (playX < visR) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(Math.max(playX, visL), 0, visR - Math.max(playX, visL), cssH);
        ctx.clip();
        traceRibbon(i0, i1, contentWidth, mid, amp);
        ctx.fillStyle = unplayedGrad!;
        ctx.fill();
        // The waiting silhouette is drawn by its edge, not its mass.
        ctx.strokeStyle = rgba(hairline, 0.42);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
      }

      // 3 - played ribbon: the accent burn with the hot core.
      if (playX > visL) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(visL, 0, Math.min(playX, visR) - visL, cssH);
        ctx.clip();
        traceRibbon(i0, i1, contentWidth, mid, amp);
        ctx.fillStyle = playedGrad!;
        ctx.fill();
        // Same crisp contour as the ghost, in the accent: both sides of the
        // playhead read as ONE silhouette, only the light changes.
        ctx.strokeStyle = rgba(accent, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();

        // Inner glow filling the WHOLE played body, rising continuously toward
        // "now" - never a bounded pool, whose inner edge reads as the lit wave
        // stopping partway on long tracks. Reverb and level lift the peak.
        if (!lowPower) {
          const washL = Math.max(visL, 0);
          if (playX > washL + 1) {
            const peak = glow(0.14 + 0.15 * fx.reverb + 0.08 * level) * (1 - 0.35 * fx.muffle);
            const wash = ctx.createLinearGradient(washL, 0, playX, 0);
            wash.addColorStop(0, rgba(accent, peak * 0.35));
            wash.addColorStop(0.55, rgba(accent, peak * 0.55));
            wash.addColorStop(1, rgba(accent, peak));
            if (additive) ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = wash;
            ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
          }
        }
        ctx.restore();
      }

      // 4 - core spine: a filament of light lying on the axis across the played
      // region; bass boost makes it pulse deeper.
      if (playX > visL) {
        const coreW = 1.6 + bass * (1.6 + 2.2 * fx.bass);
        const spine = ctx.createLinearGradient(visL, 0, playX, 0);
        spine.addColorStop(0, rgba(core, 0.06));
        spine.addColorStop(1, rgba(core, glow(0.5 + 0.35 * level)));
        if (additive) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = spine;
        ctx.fillRect(visL, mid - coreW / 2, Math.min(playX, visR) - visL, coreW);
        ctx.globalCompositeOperation = 'source-over';
      }
    }

    // 5 - spectral flame: the track's real spectrum licking along the spine
    // behind the playhead (bass hugs the playhead, air trails off).
    if (live && !lowPower && n > 1) {
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < FLAME_BINS; i++) {
        const x = playX - (i + 1) * FLAME_STRIP_W;
        if (x < visL || x > visR) continue;
        // Capped just above the envelope so the flame licks the silhouette
        // without breaking out of it.
        const h = Math.max(MIN_HALF_HEIGHT, envAt(x, contentWidth) * amp) * (0.25 + 0.8 * bins[i]);
        const tint = mix(core, ambient, i / (FLAME_BINS - 1));
        ctx.fillStyle = rgba(tint, glow((0.08 + 0.16 * bins[i]) * (1 - 0.5 * fx.muffle)));
        ctx.fillRect(x, mid - h, FLAME_STRIP_W - 1, h * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 6 - stereo weave: 8D braids two strands (accent + ambient, half a turn
    // apart) around the played spine, turning at the rotation speed.
    if (fx.is8D && n > 1 && playX > visL) {
      const strandEnd = Math.min(playX, visR);
      const phase = reducedMotion ? 0 : now * 0.001 * Math.PI * 2 * Math.max(0.15, fx.rotation);
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (let s = 0; s < 2; s++) {
        ctx.strokeStyle = rgba(s === 0 ? accent : ambient, glow(0.4));
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        let started = false;
        for (let x = Math.max(visL, 0); x <= strandEnd; x += 6) {
          const a = Math.max(MIN_HALF_HEIGHT, envAt(x, contentWidth) * amp) * 0.5;
          const y = mid + Math.sin(x * 0.02 + phase + s * Math.PI) * a;
          if (started) ctx.lineTo(x, y);
          else {
            ctx.moveTo(x, y);
            started = true;
          }
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    // 7 - onset pulses: a kick fires a band of light that travels back down the
    // played region and dies out (reverb lets it ring longer).
    if (live && !lowPower) {
      if (onset > 0.45 && now - lastPulseAt > PULSE_COOLDOWN_MS) {
        lastPulseAt = now;
        pulses.push({ x0: playX, born: now, life: 1100 * (1 + 0.9 * fx.reverb) });
      }
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (let i = pulses.length - 1; i >= 0; i--) {
        const p = pulses[i];
        const age = (now - p.born) / p.life;
        if (age >= 1) {
          pulses.splice(i, 1);
          continue;
        }
        const x = p.x0 - (now - p.born) * 0.001 * PULSE_SPEED;
        if (x < visL - 30 || x > visR + 30) continue;
        const fade = (1 - age) ** 2;
        const h = Math.max(MIN_HALF_HEIGHT, envAt(x, contentWidth) * amp) * (1.05 + 0.3 * fade);
        const band = ctx.createLinearGradient(x - 14, 0, x + 14, 0);
        band.addColorStop(0, rgba(accent, 0));
        band.addColorStop(0.5, rgba(mix(accent, core, 0.5), glow(0.4 * fade)));
        band.addColorStop(1, rgba(accent, 0));
        ctx.fillStyle = band;
        ctx.fillRect(x - 14, mid - h, 28, h * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      pulses.length = 0;
    }

    // 8 - sparks: treble lifts short-lived embers off the spine near the
    // playhead; reverb lets them linger.
    if (live && !lowPower) {
      const rate = treble * treble * 300 * dt;
      let want = Math.floor(rate);
      if (Math.random() < rate - want) want += 1;
      for (let s = 0; s < want && particles.length < PARTICLE_CAP; s++) {
        const back = Math.random() * 70;
        const x = playX - back;
        const a = Math.max(MIN_HALF_HEIGHT, envAt(x, contentWidth) * amp);
        particles.push({
          x,
          y: mid + (Math.random() * 2 - 1) * a * 0.7,
          vx: (Math.random() - 0.6) * 12,
          vy: -(8 + Math.random() * 26),
          born: now,
          life: (700 + Math.random() * 800) * (1 + 0.6 * fx.reverb),
          size: 1 + Math.random() * 1.8,
          hue: Math.random(),
        });
      }
      if (additive) ctx.globalCompositeOperation = 'lighter';
      for (let i = particles.length - 1; i >= 0; i--) {
        const pt = particles[i];
        const age = (now - pt.born) / pt.life;
        if (age >= 1) {
          particles.splice(i, 1);
          continue;
        }
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        if (pt.x < visL || pt.x > visR) continue;
        const fade = (1 - age) ** 1.5;
        ctx.fillStyle = rgba(mix(core, ambient, pt.hue * 0.7), glow(0.65 * fade));
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      particles.length = 0;
    }

    // 9 - playhead: a scanning beam of light with a reading head on the axis.
    if (playX >= visL && playX <= visR) {
      const bloomR = 26 + 44 * level + 16 * onset;
      if (!lowPower) {
        const bloom = ctx.createRadialGradient(playX, mid, 0, playX, mid, bloomR);
        bloom.addColorStop(0, rgba(accent, glow(0.30 * (0.45 + level))));
        bloom.addColorStop(1, rgba(accent, 0));
        if (additive) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = bloom;
        ctx.fillRect(playX - bloomR, mid - bloomR, bloomR * 2, bloomR * 2);
        ctx.globalCompositeOperation = 'source-over';
      }

      const blade = ctx.createLinearGradient(0, VERTICAL_PAD, 0, cssH - VERTICAL_PAD);
      blade.addColorStop(0, rgba(accent, 0.15));
      blade.addColorStop(0.3, rgba(core, 0.95));
      blade.addColorStop(0.7, rgba(core, 0.95));
      blade.addColorStop(1, rgba(accent, 0.15));
      ctx.fillStyle = blade;
      ctx.fillRect(playX - 1, VERTICAL_PAD, 2, cssH - VERTICAL_PAD * 2);

      // Reading head - swells a touch on the kick.
      const headR = 3.5 + 1.5 * onset;
      ctx.fillStyle = rgba(core, 0.98);
      ctx.beginPath();
      ctx.arc(playX, mid, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(accent, 0.6);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(playX, mid, headR + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Close the power-on clip and draw the scanning beam at the print front.
    bootActive = booting;
    if (booting) {
      ctx.restore();
      const fadeOut = 1 - bootT ** 3;
      if (!lowPower) {
        const bloom = ctx.createRadialGradient(sweepX, mid, 0, sweepX, mid, 60);
        bloom.addColorStop(0, rgba(core, glow(0.3 * fadeOut)));
        bloom.addColorStop(1, rgba(core, 0));
        if (additive) ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = bloom;
        ctx.fillRect(sweepX - 60, mid - 60, 120, 120);
        ctx.globalCompositeOperation = 'source-over';
      }
      const beam = ctx.createLinearGradient(0, VERTICAL_PAD, 0, cssH - VERTICAL_PAD);
      beam.addColorStop(0, rgba(core, 0));
      beam.addColorStop(0.5, rgba(core, 0.85 * fadeOut));
      beam.addColorStop(1, rgba(core, 0));
      ctx.fillStyle = beam;
      ctx.fillRect(sweepX - 1, VERTICAL_PAD, 2, cssH - VERTICAL_PAD * 2);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  return {
    draw,
    /** True while decorations still need full-rate frames outside playback
     *  (fading embers/pulses, or the power-on sweep printing itself). */
    hasLiveOverlays() {
      return particles.length > 0 || pulses.length > 0 || bootActive;
    },
    destroy() {
      particles.length = 0;
      pulses.length = 0;
    },
  };
}

export type WaveInstrument = ReturnType<typeof createWaveInstrument>;
