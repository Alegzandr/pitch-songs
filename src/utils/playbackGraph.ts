import type { AudioProcessingOptions } from './audioProcessor';
import {
  createEffectChain,
  applyEffectOptions,
  applyEqGains,
  disconnectEffectChain,
  type EffectChain,
} from './effectGraph';

export interface PlaybackGraph {
  source: AudioBufferSourceNode;
  gain: GainNode;
  analyser: AnalyserNode | null;
  chain: EffectChain;
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

  return { source, gain, analyser, chain };
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
  disconnectEffectChain(graph.chain);
  safeDisconnect(graph.gain);
  safeDisconnect(graph.analyser);
}
