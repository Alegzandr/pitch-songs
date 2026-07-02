// Gain/cutoff curves shared by the offline renderer (audioProcessor) and the
// live playback graph (effectGraph), so both engines sound identical.

import { AUDIO_EFFECTS } from '../constants';

/**
 * Underwater muffle cutoff (Hz) for a given amount (0..1). The sweep is exponential
 * so the perceived "submerging" is even across the slider: 0 → transparent (MAX),
 * 1 → deep muffle (MIN).
 */
export function underwaterCutoffHz(amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  const { UNDERWATER_CUTOFF_MAX_HZ: max, UNDERWATER_CUTOFF_MIN_HZ: min } = AUDIO_EFFECTS.BASS_BOOST;
  return max * Math.pow(min / max, a);
}

/**
 * Reverb makeup gain for a given amount (0..1). The wet/dry crossfade
 * (`dry = 1 - 0.5·amount`) pulls the direct signal down up to -6 dB while the
 * decorrelated wet tail only partly fills it back in, so the mix gets quieter as
 * reverb rises. Because dry and wet are decorrelated their powers add, giving an
 * exact compensation: out / sqrt((1-0.5a)² + k·a²), where k ≈ 0.0525 is the
 * measured power the normalized convolver returns relative to the input. Derived
 * by measuring integrated loudness (BS.1770); residual is within ±0.08 dB and the
 * value is content-independent. Restoring loudness adds no clipping since reverb
 * lowers the crest factor.
 */
export function reverbMakeupGain(amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  return 1 / Math.sqrt((1 - 0.5 * a) ** 2 + 0.0525 * a * a);
}

/**
 * Bass-boost output trim for a given intensity (0..1). The +18 dB low shelf adds
 * level and eats headroom, so the output is scaled back as the boost grows. The
 * loudness gain accelerates (a shelf is dB-linear in intensity), so the trim is
 * quadratic rather than linear. The 0.4 coefficient is a content-centered
 * compromise measured across a bass-heavy track and pink noise (BS.1770): it keeps
 * neutral material within ±1 dB and caps a worst-case full boost at ~+1.6 dB
 * instead of the +3.5 dB the previous linear 1-0.25·i left.
 */
export function bassBoostTrimGain(intensity: number): number {
  const i = Math.max(0, Math.min(1, intensity));
  return 1 - 0.4 * i * i;
}
