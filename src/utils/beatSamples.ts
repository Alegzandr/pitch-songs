import { NIGHTCORE } from '../constants';

/** The one-shot roles in the Nightcore grid. */
export type BeatRole = 'kick' | 'clap' | 'finish';

export interface BeatSample {
  buffer: AudioBuffer;
  /**
   * Seconds from the buffer head to the sample's perceived attack. The scheduler
   * starts the source this much early so the transient lands on the beat instead of
   * trailing it. Measured once at decode time (see detectAttackOffset).
   */
  attackOffsetSec: number;
}

export type BeatSampleSet = Record<BeatRole, BeatSample>;

/**
 * Where the ear places a one-shot's hit, measured once at decode time so the scheduler
 * can start the sample that much early and land the perceived attack on the grid.
 *
 * The hit is the transient: the first sample rising to ATTACK_THRESHOLD_RATIO of the
 * early-window peak. That holds for the kick too - the beat grid itself is phased to
 * the *attacks* of the track's own drums (see refineDownbeat in tempo.ts), and real
 * kicks carry their sub body ~10 ms behind their click just like our sample does. So
 * click-on-click keeps every layer of both hits coincident; aligning the sample's sub
 * peak instead was measured to fire our click ~11 ms ahead of the music's - an audible
 * flam. Bounded by MAX_ALIGN_SECONDS so a slow-swell sample can't yank its hit wildly
 * early.
 */
export function detectAttackOffset(buffer: AudioBuffer): number {
  const { ATTACK_THRESHOLD_RATIO, MAX_ALIGN_SECONDS } = NIGHTCORE;
  const sampleRate = buffer.sampleRate || 44100;
  const maxFrames = Math.min(buffer.length, Math.ceil(MAX_ALIGN_SECONDS * sampleRate) + 1);
  if (maxFrames <= 0) return 0;

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) channels.push(buffer.getChannelData(ch));

  // Peak amplitude within the early window (the transient threshold's reference).
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < maxFrames; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
    }
  }
  if (peak <= 0) return 0;

  // Transient: first sample rising to ATTACK_THRESHOLD_RATIO of that peak.
  const threshold = peak * ATTACK_THRESHOLD_RATIO;
  for (let i = 0; i < maxFrames; i++) {
    for (const data of channels) {
      if (Math.abs(data[i]) >= threshold) {
        return Math.min(i / sampleRate, MAX_ALIGN_SECONDS);
      }
    }
  }
  return 0;
}

// Decode the four samples once and reuse the buffers everywhere. AudioBuffers are
// not bound to the context that decoded them, so the same set feeds both the live
// AudioContext and the export-time OfflineAudioContext. The promise is cached (not
// just the result) so concurrent callers share one fetch+decode.
let samplesPromise: Promise<BeatSampleSet> | null = null;

async function fetchDecode(
  ctx: BaseAudioContext,
  url: string,
): Promise<AudioBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch beat sample ${url}: ${response.status}`);
  const data = await response.arrayBuffer();
  return ctx.decodeAudioData(data);
}

/**
 * Load and decode the Nightcore samples, caching the decoded set for the app's
 * lifetime. Rejects if any sample can't be fetched/decoded; callers treat that as
 * "beats unavailable" and fall back to a silent bed rather than breaking playback.
 */
export function loadBeatSamples(ctx: BaseAudioContext): Promise<BeatSampleSet> {
  if (!samplesPromise) {
    samplesPromise = (async () => {
      const entries = await Promise.all(
        (Object.entries(NIGHTCORE.SAMPLES) as [BeatRole, string][]).map(
          async ([role, url]) => {
            const buffer = await fetchDecode(ctx, url);
            return [role, { buffer, attackOffsetSec: detectAttackOffset(buffer) }] as const;
          },
        ),
      );
      return Object.fromEntries(entries) as BeatSampleSet;
    })().catch((error) => {
      // Drop the cached rejection so a later attempt (e.g. after a transient network
      // blip) can retry instead of being stuck with the failed promise forever.
      samplesPromise = null;
      throw error;
    });
  }
  return samplesPromise;
}

/** Test-only: forget the cached samples so each test starts from a clean loader. */
export function resetBeatSamplesForTest(): void {
  samplesPromise = null;
}
