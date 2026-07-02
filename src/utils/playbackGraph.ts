import type { AudioProcessingOptions } from './audioProcessor';
import {
  createEffectChain,
  applyEffectOptions,
  applyEqGains,
  disconnectEffectChain,
  type EffectChain,
} from './effectGraph';
import { BeatScheduler } from './beatScheduler';
import { EFFECT_DEFAULTS } from '../constants';

export interface PlaybackGraph {
  source: AudioBufferSourceNode;
  gain: GainNode;
  analyser: AnalyserNode | null;
  chain: EffectChain;
  /** Nightcore percussion bed; its output joins the master gain (post-analyser). */
  beats: BeatScheduler;
}

interface PlaybackGraphSettings {
  volume: number;
  options: AudioProcessingOptions;
  eqGains: number[];
}

/**
 * Wires up the live playback graph: source → effect chain → volume gain →
 * destination, with an optional analyser teed off the chain output.
 */
export function buildPlaybackGraph(
  audioContext: AudioContext,
  buffer: AudioBuffer,
  { volume, options, eqGains }: PlaybackGraphSettings,
): PlaybackGraph {
  // Volume gain is created first so it stays the master/output node.
  const gain = audioContext.createGain();
  gain.gain.value = volume;

  const chain = createEffectChain(audioContext);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.loop = false;
  source.playbackRate.value = options.speedMultiplier || 1;

  // The analyser tees off the effect chain *before* the volume gain so the live
  // spectrum (and the UI's "breathe with the music" reactivity) tracks the music
  // and its effects, never the user's listening volume. It sits on a parallel
  // branch and doesn't need to reach the destination - an AnalyserNode reads its
  // input whether or not it's connected onward. Optional: skipped when the context
  // can't create one (older engines, tests).
  const analyser =
    typeof audioContext.createAnalyser === 'function' ? audioContext.createAnalyser() : null;
  if (analyser) {
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.8;
  }

  source.connect(chain.input);
  chain.output.connect(gain);
  gain.connect(audioContext.destination);
  if (analyser) {
    chain.output.connect(analyser);
  }
  applyEffectOptions(chain, options, audioContext, false);
  applyEqGains(chain, eqGains, audioContext, false);

  // Nightcore beat bed: joins the master gain *after* the analyser tap, so the
  // metronome never feeds the "breathe with the music" reactivity, but the master
  // volume still governs the overall level. Its own gain gives the beats a level
  // independent of the track. The playback hook drives its anchor/start/stop.
  const beats = new BeatScheduler(
    audioContext,
    options.beatsVolume ?? EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_DEFAULT,
  );
  beats.output.connect(gain);
  beats.setTempo(options.bpm ?? 0, options.beatOffsetSec ?? 0, options.beatsPerBar ?? 4);
  beats.setPattern(!!options.enableBeats);

  return { source, gain, analyser, chain, beats };
}

function safeDisconnect(node: AudioNode | null) {
  try {
    node?.disconnect();
  } catch {
    // already disconnected
  }
}

export function teardownPlaybackGraph(graph: PlaybackGraph | null): void {
  if (!graph) return;
  graph.source.onended = null;
  try {
    graph.source.stop();
  } catch {
    // never started or already stopped
  }
  safeDisconnect(graph.source);
  graph.beats.dispose();
  disconnectEffectChain(graph.chain);
  safeDisconnect(graph.gain);
  safeDisconnect(graph.analyser);
}
