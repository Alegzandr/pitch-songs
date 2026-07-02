import { AUDIO_SIGNAL } from '../constants';

/**
 * Every reverb and ambience convolver in the app is fed the same shape of impulse
 * response: a 2-channel buffer of exponentially-decaying white noise. The tail
 * length, decay rate and per-channel gain are the only things that vary, so this
 * single factory backs all of them (live graph and offline render alike).
 *
 * @param tailSeconds   total impulse length, in seconds
 * @param decaySeconds  time constant of the exponential falloff, in seconds
 * @param channelGains  per-channel scale; asymmetric values widen the stereo image
 */
export function createDecayingNoiseImpulse(
  ctx: BaseAudioContext,
  tailSeconds: number,
  decaySeconds: number,
  channelGains: readonly [number, number] = [1, 1],
): AudioBuffer {
  const { sampleRate } = ctx;
  const length = Math.max(1, Math.floor(sampleRate * tailSeconds));
  const falloff = sampleRate * decaySeconds;
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    const gain = channelGains[channel];
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / falloff) * gain;
    }
  }

  return impulse;
}

// Impulses are pure noise+decay buffers that only depend on their parameters and
// the sample rate, and AudioBuffers are context-agnostic - so they are cached and
// reused across contexts (per-export OfflineAudioContexts and the live graph
// alike) instead of regenerating hundreds of thousands of Math.random samples.
// This also makes successive renders of the same settings deterministic.
const impulseCache = new Map<string, AudioBuffer>();
const IMPULSE_CACHE_MAX_ENTRIES = 8;

/** Cached variant of {@link createDecayingNoiseImpulse}; same parameters. */
export function getDecayingNoiseImpulse(
  ctx: BaseAudioContext,
  tailSeconds: number,
  decaySeconds: number,
  channelGains: readonly [number, number] = [1, 1],
): AudioBuffer {
  const key = `${ctx.sampleRate}:${tailSeconds}:${decaySeconds}:${channelGains.join(',')}`;
  let buffer = impulseCache.get(key);
  if (!buffer) {
    if (impulseCache.size >= IMPULSE_CACHE_MAX_ENTRIES) {
      const oldest = impulseCache.keys().next().value;
      if (oldest !== undefined) impulseCache.delete(oldest);
    }
    buffer = createDecayingNoiseImpulse(ctx, tailSeconds, decaySeconds, channelGains);
    impulseCache.set(key, buffer);
  }
  return buffer;
}

/** Short tail for the constant 8D ambience bed - tight enough to sit under the music. */
const EIGHT_D_BED_TAIL_SECONDS = 0.5;
const EIGHT_D_BED_DECAY_SECONDS = 0.1;

/**
 * Short, slightly stereo-widened impulse for the 8D ambience bed: the asymmetric
 * channel gain gives the constant reverb width so it reads as spatial, not mono.
 * Shared by the offline render and the live playback graph.
 */
export function getEightDBedImpulse(ctx: BaseAudioContext): AudioBuffer {
  return getDecayingNoiseImpulse(ctx, EIGHT_D_BED_TAIL_SECONDS, EIGHT_D_BED_DECAY_SECONDS, [
    AUDIO_SIGNAL.EIGHT_D_MIX.STEREO_VARIATION_LEFT,
    AUDIO_SIGNAL.EIGHT_D_MIX.STEREO_VARIATION_RIGHT,
  ]);
}
