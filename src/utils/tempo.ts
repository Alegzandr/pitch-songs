import { TEMPO_DETECTION } from '../constants';

/**
 * Constant-tempo estimation for the Nightcore beat bed.
 *
 * Reverie loads arbitrary user tracks with no timing metadata, so the beat grid's
 * BPM has to be measured from the audio itself. The estimate is deliberately a
 * single constant tempo + a phase: a Nightcore percussion overlay is a fixed 4/4
 * grid, and chasing tempo drift would fight the effect rather than serve it.
 *
 * Pipeline (all cheap, a few ms for a multi-minute track):
 *   1. Downmix to mono and build an onset-strength envelope (half-wave-rectified
 *      energy flux over ~11 ms hops) - a spike per transient.
 *   2. Autocorrelate the envelope over the lag range for MIN..MAX BPM, weighting
 *      each lag toward PREFERRED_BPM so a track's half/double tempo can't steal the
 *      octave (raw autocorrelation's usual failure).
 *   3. Rank the pick's metrical relatives (×2, ×1/2, ×3/2, ...) by harmonic-comb
 *      energy - the ACF's winner is sometimes the 2-beat or dotted-quarter lag, not
 *      the beat - refining each to a fractional BPM (beat-bin DFT magnitude sweep);
 *      lag quantization alone is a 1-3 BPM error, which walks the grid off the music
 *      within a minute.
 *   4. Recover the beat phase by sliding a pulse train at the winning period over
 *      the envelope and taking the offset with the most onset energy.
 */

/** Supported meters for the Nightcore grid: waltz (3) or common time (4). */
export type BeatsPerBar = 3 | 4;

export interface TempoEstimate {
  /** Estimated tempo in beats per minute (constant). */
  bpm: number;
  /** Seconds from the track start to the first downbeat of the grid. */
  beatOffsetSec: number;
  /** Detected meter (beats per bar): 3 (waltz) or 4 (common time). */
  beatsPerBar: BeatsPerBar;
}

// Cache per AudioBuffer (like getBufferLoudness): the same buffer object is
// re-attached on every replay/seek, so estimate it once and let the WeakMap drop it
// with the track.
const cache = new WeakMap<AudioBuffer, TempoEstimate>();

/**
 * Build the onset-strength envelope: per-hop RMS energy, half-wave-rectified first
 * difference. The result is a low-rate signal (sampleRate / hop) that spikes on
 * transients, which is what the tempo search keys on.
 */
function onsetEnvelope(samples: Float32Array, hop: number): Float32Array {
  const frames = Math.floor(samples.length / hop);
  if (frames < 2) return new Float32Array(0);

  const energy = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let sumSq = 0;
    const start = f * hop;
    for (let i = 0; i < hop; i++) {
      const v = samples[start + i];
      sumSq += v * v;
    }
    // Log-energy compresses the dynamic range so a loud chorus doesn't dwarf the
    // onsets of a quiet verse when we correlate.
    energy[f] = Math.log1p(sumSq / hop);
  }

  const env = new Float32Array(frames);
  for (let f = 1; f < frames; f++) {
    const diff = energy[f] - energy[f - 1];
    env[f] = diff > 0 ? diff : 0; // half-wave rectify: onsets, not offsets
  }
  return env;
}

/** log2 helper kept explicit for the octave-preference weight. */
function log2(x: number): number {
  return Math.log(x) / Math.LN2;
}

/**
 * One-pole low-pass to isolate the kick band before onset detection. Cheap (a single
 * multiply-add per sample) and its ~1 ms group delay is negligible against the
 * ~11 ms envelope frame - all we need is the kick's onset *timing*, not its shape.
 */
function lowpassMono(samples: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const out = new Float32Array(samples.length);
  const dt = 1 / sampleRate;
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const a = dt / (rc + dt);
  let y = 0;
  for (let i = 0; i < samples.length; i++) {
    y += a * (samples[i] - y);
    out[i] = y;
  }
  return out;
}

/**
 * Phase of an onset envelope at a given period, via its single-bin DFT. A pulse train
 * at period T has DFT phase 2π·p/T at that bin, so arg(X) recovers the sub-frame
 * offset p directly - no integer-lag striding, which drifts off the true onsets over
 * a long track (frames-per-beat is fractional) and smears the estimate by up to a beat.
 * DC doesn't reach this bin, so the raw (non-negative) envelope is used as-is. The
 * returned offset is wrapped into [0, periodFrames).
 */
function phaseAtPeriod(env: Float32Array, periodFrames: number): number {
  let re = 0;
  let im = 0;
  for (let n = 0; n < env.length; n++) {
    const angle = (2 * Math.PI * n) / periodFrames;
    re += env[n] * Math.cos(angle);
    im += env[n] * Math.sin(angle);
  }
  const phaseFrames = (Math.atan2(im, re) / (2 * Math.PI)) * periodFrames;
  return ((phaseFrames % periodFrames) + periodFrames) % periodFrames;
}

/**
 * Energy of the envelope's single-bin DFT at a given period, via incremental complex
 * rotation (no per-sample trig). The tempo whose bin captures the most envelope
 * energy is the track's true beat rate, at a resolution the integer-lag
 * autocorrelation can't reach.
 */
function beatBinEnergy(env: Float32Array, periodFrames: number): number {
  const angle = (2 * Math.PI) / periodFrames;
  const stepRe = Math.cos(angle);
  const stepIm = Math.sin(angle);
  let rotRe = 1;
  let rotIm = 0;
  let re = 0;
  let im = 0;
  for (let n = 0; n < env.length; n++) {
    re += env[n] * rotRe;
    im += env[n] * rotIm;
    const nextRe = rotRe * stepRe - rotIm * stepIm;
    rotIm = rotRe * stepIm + rotIm * stepRe;
    rotRe = nextRe;
  }
  return re * re + im * im;
}

/**
 * Refine the coarse integer-lag tempo to fractional-BPM precision (see the
 * TEMPO_DETECTION.REFINE_* docs for why the lag grid isn't good enough, and why a
 * harmonic comb rather than the fundamental bin alone). Sweeps the summed DFT energy
 * at 1×..REFINE_HARMONICS× the beat frequency around the coarse pick, coarse step
 * first, then a fine pass around that winner. The winner's comb energy is returned
 * with it so metrical candidates can be ranked against each other.
 */
function refineBpm(
  centered: Float32Array,
  frameRate: number,
  coarseBpm: number,
): { bpm: number; energy: number } {
  const { REFINE_RANGE_RATIO, REFINE_COARSE_STEP_BPM, REFINE_FINE_STEP_BPM, REFINE_HARMONICS } =
    TEMPO_DETECTION;
  const combEnergy = (bpm: number): number => {
    let sum = 0;
    for (let k = 1; k <= REFINE_HARMONICS; k++) {
      const periodFrames = (frameRate * 60) / (bpm * k);
      if (periodFrames < 2) break; // past the envelope's Nyquist
      sum += beatBinEnergy(centered, periodFrames);
    }
    return sum;
  };
  const sweep = (center: number, halfRange: number, step: number): { bpm: number; energy: number } => {
    let best = center;
    let bestEnergy = -Infinity;
    for (let bpm = center - halfRange; bpm <= center + halfRange; bpm += step) {
      const energy = combEnergy(bpm);
      if (energy > bestEnergy) {
        bestEnergy = energy;
        best = bpm;
      }
    }
    return { bpm: best, energy: bestEnergy };
  };
  const coarse = sweep(coarseBpm, coarseBpm * REFINE_RANGE_RATIO, REFINE_COARSE_STEP_BPM);
  return sweep(coarse.bpm, REFINE_COARSE_STEP_BPM, REFINE_FINE_STEP_BPM);
}

/**
 * Beat-synchronous accent series: the onset energy summed in a short window around
 * each beat, starting at the downbeat. Its self-similarity at bar-length lags is what
 * meter detection reads.
 */
function beatAccents(env: Float32Array, downbeatFrame: number, periodFrames: number): Float32Array {
  const radius = Math.max(1, Math.round(periodFrames * TEMPO_DETECTION.METER_ACCENT_WINDOW_RATIO));
  const accents: number[] = [];
  for (let center = downbeatFrame; center < env.length; center += periodFrames) {
    let sum = 0;
    const lo = Math.max(0, Math.round(center - radius));
    const hi = Math.min(env.length, Math.round(center + radius + 1));
    for (let i = lo; i < hi; i++) sum += env[i];
    accents.push(sum);
  }
  return Float32Array.from(accents);
}

/**
 * Snap a coarse downbeat (in samples) to the true kick-band onset nearby. The
 * onset-envelope phase reads a few ms early - log-energy flux front-loads the first
 * rise out of silence - so we search a short window around the estimate for the
 * steepest low-band energy rise (the physical attack) and lock the grid there. The
 * search radius stays well under half a beat, so the grid can't slide onto a
 * neighbouring beat; if no real rise is found (the window sits in a decay), the coarse
 * estimate is kept untouched.
 */
function refineDownbeat(
  lowSignal: Float32Array,
  centerSample: number,
  beatSamples: number,
  sampleRate: number,
): number {
  const radius = Math.min(
    Math.round(sampleRate * TEMPO_DETECTION.DOWNBEAT_REFINE_RADIUS_SEC),
    Math.floor(beatSamples / 2) - 1,
  );
  const win = Math.max(1, Math.round(sampleRate * TEMPO_DETECTION.ONSET_RISE_WINDOW_SEC));
  if (radius <= 0) return centerSample;

  const lo = Math.max(win, Math.round(centerSample - radius));
  const hi = Math.min(lowSignal.length - win - 1, Math.round(centerSample + radius));
  if (hi <= lo) return centerSample;

  // Short-time energy over [start, start+win): the rise across a sample is the energy
  // just after it minus the energy just before, so its peak marks the onset.
  const energyAt = (start: number): number => {
    let sum = 0;
    for (let i = start; i < start + win; i++) sum += lowSignal[i] * lowSignal[i];
    return sum;
  };

  let best = centerSample;
  let bestRise = 0; // only a genuine (positive) rise moves the grid
  for (let s = lo; s <= hi; s++) {
    const rise = energyAt(s) - energyAt(s - win);
    if (rise > bestRise) {
      bestRise = rise;
      best = s;
    }
  }
  return best;
}

/** Normalized autocorrelation of a series at one lag (mean-removed, energy-scaled). */
function autocorrAtLag(a: Float32Array, lag: number): number {
  if (a.length <= lag) return 0;
  let mean = 0;
  for (let i = 0; i < a.length; i++) mean += a[i];
  mean /= a.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - mean;
    den += d * d;
    if (i >= lag) num += d * (a[i - lag] - mean);
  }
  return den > 0 ? num / den : 0;
}

/**
 * Decide 3/4 vs 4/4 from the accent series. A 4/4 groove repeats its accent pattern
 * every 4 beats (strong-weak-strong-weak), a waltz every 3 (strong-weak-weak), so the
 * bar-length lag that best predicts the accents names the meter. Triple only wins by a
 * margin - common time is the safe default - and only with enough beats to measure.
 */
function estimateMeter(env: Float32Array, downbeatFrame: number, periodFrames: number): BeatsPerBar {
  const { METER_MIN_BEATS, METER_TRIPLE_MARGIN, DEFAULT_BEATS_PER_BAR } = TEMPO_DETECTION;
  const accents = beatAccents(env, downbeatFrame, periodFrames);
  if (accents.length < METER_MIN_BEATS) return DEFAULT_BEATS_PER_BAR;
  const triple = autocorrAtLag(accents, 3);
  const quad = autocorrAtLag(accents, 4);
  return triple > quad * METER_TRIPLE_MARGIN ? 3 : 4;
}

/**
 * Estimate a constant tempo (and beat phase) from mono PCM. Exposed separately from
 * the AudioBuffer wrapper so it can be unit-tested on synthetic click trains without
 * the Web Audio types.
 */
export function estimateTempo(samples: Float32Array, sampleRate: number): TempoEstimate {
  const {
    MIN_BPM,
    MAX_BPM,
    PREFERRED_BPM,
    PREFERENCE_OCTAVES,
    HOP_SIZE,
    KICK_LOWPASS_HZ,
    DEFAULT_BPM,
    DEFAULT_BEATS_PER_BAR,
    OCTAVE_CANDIDATE_RATIOS,
  } = TEMPO_DETECTION;

  const fallback: TempoEstimate = { bpm: DEFAULT_BPM, beatOffsetSec: 0, beatsPerBar: DEFAULT_BEATS_PER_BAR };
  if (!sampleRate || samples.length < sampleRate) return fallback;

  const hop = HOP_SIZE;
  const frameRate = sampleRate / hop; // envelope frames per second
  const env = onsetEnvelope(samples, hop);
  if (env.length < 4) return fallback;

  // Mean-remove so the autocorrelation measures periodicity, not DC energy.
  let mean = 0;
  for (let i = 0; i < env.length; i++) mean += env[i];
  mean /= env.length;
  const centered = new Float32Array(env.length);
  let hasEnergy = false;
  for (let i = 0; i < env.length; i++) {
    centered[i] = env[i] - mean;
    if (env[i] > 0) hasEnergy = true;
  }
  if (!hasEnergy) return fallback;

  // Lag (in envelope frames) for a given BPM: frames-per-beat = frameRate * 60 / bpm.
  const minLag = Math.max(1, Math.floor((frameRate * 60) / MAX_BPM));
  const maxLag = Math.min(env.length - 1, Math.ceil((frameRate * 60) / MIN_BPM));
  if (maxLag <= minLag) return fallback;

  // Denominator of the log-Gaussian tempo-preference weight (in octaves).
  const prefDenom = 2 * PREFERENCE_OCTAVES * PREFERENCE_OCTAVES;

  let bestLag = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acf = 0;
    for (let i = lag; i < centered.length; i++) {
      acf += centered[i] * centered[i - lag];
    }
    if (acf <= 0) continue;
    const bpm = (frameRate * 60) / lag;
    // Prefer tempi near PREFERRED_BPM in log space so an equally-strong half/double
    // peak loses the tie - this is what stops 174 BPM tracks reading as 87.
    const octaveOffset = log2(bpm / PREFERRED_BPM);
    const weight = Math.exp(-(octaveOffset * octaveOffset) / prefDenom);
    const score = acf * weight;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  // The winning lag names a real periodicity, but not necessarily the *beat* - a
  // backbeat's 2-beat repeat or a dotted-quarter figure can out-correlate it (see the
  // OCTAVE_CANDIDATE_RATIOS docs). So every metrical relative of the pick that lands
  // in range is refined to fractional BPM and they compete on comb energy under the
  // same tempo preference the lag search used. Ratio 1 always runs (even when edge
  // rounding puts the raw pick a hair out of range), so there is always a winner.
  const coarseBpm = (frameRate * 60) / bestLag;
  let bpm: number = DEFAULT_BPM;
  let bestWeighted = -Infinity;
  for (const ratio of OCTAVE_CANDIDATE_RATIOS) {
    const candidate = coarseBpm * ratio;
    if (ratio !== 1 && (candidate < MIN_BPM || candidate > MAX_BPM)) continue;
    const refined = refineBpm(centered, frameRate, candidate);
    const octaveOffset = log2(refined.bpm / PREFERRED_BPM);
    const weighted = refined.energy * Math.exp(-(octaveOffset * octaveOffset) / prefDenom);
    if (weighted > bestWeighted) {
      bestWeighted = weighted;
      bpm = refined.bpm;
    }
  }
  const periodFrames = (frameRate * 60) / bpm; // fractional frames per beat
  const twoBeatFrames = 2 * periodFrames;

  // Beat-level phase from the full-band envelope. The kick (beats 1 & 3) and the
  // backbeat (beats 2 & 4) are one beat (T) apart, so at period T they share a phase:
  // this pins the grid to the beats, unambiguously, whichever is louder.
  const p = phaseAtPeriod(env, periodFrames);

  // But *which* beats carry the kick is a 2-beat question the beat-period phase can't
  // answer - land it wrong and the kick sits on the backbeat (the offbeat feel). The
  // kick lives in the low end, so resolve the parity from a low-passed copy: of the
  // two half-bar-apart candidates, keep the one with more kick-band onset energy on
  // the beats we'd fire the kick. Four-on-the-floor ties and either choice is fine.
  const lowSignal = lowpassMono(samples, sampleRate, KICK_LOWPASS_HZ);
  const lowEnv = onsetEnvelope(lowSignal, hop);
  const kickEnergy = (startFrame: number): number => {
    let sum = 0;
    for (let f = startFrame; f < lowEnv.length; f += twoBeatFrames) {
      const idx = Math.round(f);
      if (idx >= 0 && idx < lowEnv.length) sum += lowEnv[idx];
    }
    return sum;
  };
  const downbeat = kickEnergy(p + periodFrames) > kickEnergy(p) ? p + periodFrames : p;
  const phaseFrames = ((downbeat % twoBeatFrames) + twoBeatFrames) % twoBeatFrames;

  // Meter groups whole beats, so measure it from the beat-level phase (the downbeat).
  const beatsPerBar = estimateMeter(env, phaseFrames, periodFrames);

  // Refine the (early-biased) envelope-frame downbeat to the true full-rate kick-band
  // onset, so the grid sits on the beat instead of a few ms ahead of it.
  const refinedSample = refineDownbeat(lowSignal, phaseFrames * hop, periodFrames * hop, sampleRate);

  return {
    bpm,
    beatOffsetSec: Math.max(0, refinedSample) / sampleRate,
    beatsPerBar,
  };
}

/**
 * Estimate the tempo of a decoded track. Downmixes to mono, delegates to
 * estimateTempo, and caches the result per buffer.
 */
export function detectTempo(buffer: AudioBuffer): TempoEstimate {
  const cached = cache.get(buffer);
  if (cached !== undefined) return cached;

  const channelCount = buffer.numberOfChannels;
  const length = buffer.length;
  let mono: Float32Array;
  if (channelCount === 1) {
    mono = buffer.getChannelData(0);
  } else {
    mono = new Float32Array(length);
    for (let ch = 0; ch < channelCount; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) mono[i] += data[i] / channelCount;
    }
  }

  const estimate = estimateTempo(mono, buffer.sampleRate || 44100);
  cache.set(buffer, estimate);
  return estimate;
}
