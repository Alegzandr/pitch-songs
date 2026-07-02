import { AUDIO_EFFECTS, AUDIO_SIGNAL } from '../constants';
import { underwaterCutoffHz, reverbMakeupGain, bassBoostTrimGain } from './dsp';
import { getDecayingNoiseImpulse, getEightDBedImpulse } from './impulse';
import type { AudioProcessingOptions } from './audioProcessor';

/**
 * Live effect graph for real-time, DAW-style tweaking.
 *
 * The same four effects the offline renderer bakes (speed, slow + reverb, 8D, bass
 * boost) are wired as persistent nodes so their parameters can be ramped smoothly
 * while the track plays. The graph is rebuilt per playback (sources and oscillators
 * are one-shot), then `applyEffectOptions` is called to set or ramp every parameter.
 *
 * Signal path:
 *   source -> highpass -> lowshelf -> peaking -> underwater lowpass
 *          -> (dry + convolver/wet) -> mix
 *          -> eq[0..5] -> stereo panner -> out -> [caller's volume gain] -> destination
 * 8D motion: oscillator -> panDepth gain -> panner.pan
 * 8D bed:    mix -> eightDConvolver -> eightDBed -> out  (un-panned, constant)
 *
 * The 8D bed taps the pre-pan mix and bypasses the panner, so a quiet reverb
 * ambience stays in both ears while the dry signal orbits. Without it, the panner
 * sweeps the whole signal and a complete silence rotates opposite the music.
 */
export interface EffectChain {
  input: AudioNode;
  output: AudioNode;
  highpass: BiquadFilterNode;
  lowshelf: BiquadFilterNode;
  peak: BiquadFilterNode;
  /** Underwater muffle lowpass (bass-boost mode) + its slow cutoff-wobble LFO. */
  underwaterLowpass: BiquadFilterNode;
  underwaterLfo: OscillatorNode;
  underwaterDepth: GainNode;
  dryGain: GainNode;
  wetGain: GainNode;
  convolver: ConvolverNode;
  mix: GainNode;
  /** 6-band listening EQ (peaking/shelf), in canonical band order. Playback only. */
  eq: BiquadFilterNode[];
  panner: StereoPannerNode;
  panDepth: GainNode;
  osc: OscillatorNode;
  eightDConvolver: ConvolverNode;
  eightDBed: GainNode;
  out: GainNode;
  /**
   * Live routing flags: each convolver's INPUT is attached only while its effect
   * is audible, so no convolution runs during plain playback (the 3 s reverb IR
   * is by far the graph's most expensive node). Detaching only the input is
   * click-free by construction: the convolver keeps ringing out its stored tail
   * through the (ramped-down) wet gain, and on re-attach the wet signal builds
   * back up through the IR - the output never jumps.
   */
  reverbRouted: boolean;
  bedRouted: boolean;
}

/** Smooth-transition time constant (~150 ms perceived), DAW-like, no zipper noise. */
const RAMP_TIME_CONSTANT = 0.04;
/** Fixed reverb tail length in seconds; wetness is controlled by the wet gain. */
const REVERB_SECONDS = 3;
const REVERB_DECAY_SECONDS = 0.9;

export function createEffectChain(ctx: AudioContext): EffectChain {
  const highpass = ctx.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = AUDIO_EFFECTS.BASS_BOOST.HIGHPASS_FREQUENCY_HZ;
  highpass.Q.value = 0.7;

  const lowshelf = ctx.createBiquadFilter();
  lowshelf.type = 'lowshelf';
  lowshelf.frequency.value = AUDIO_EFFECTS.BASS_BOOST.LOWSHELF_FREQUENCY_HZ;

  const peak = ctx.createBiquadFilter();
  peak.type = 'peaking';
  peak.frequency.value = AUDIO_EFFECTS.BASS_BOOST.PEAKING_FREQUENCY_HZ;
  peak.Q.value = 1;

  // Underwater muffle: starts wide open (transparent) and its cutoff is ramped down
  // live as the amount rises. The LFO adds a slow swell to the cutoff; its depth is 0
  // until the effect is dialled in, so the filter is inaudible at rest.
  const underwaterLowpass = ctx.createBiquadFilter();
  underwaterLowpass.type = 'lowpass';
  underwaterLowpass.frequency.value = AUDIO_EFFECTS.BASS_BOOST.UNDERWATER_CUTOFF_MAX_HZ;
  underwaterLowpass.Q.value = 0.7;
  const underwaterLfo = ctx.createOscillator();
  underwaterLfo.type = 'sine';
  underwaterLfo.frequency.value = AUDIO_EFFECTS.BASS_BOOST.UNDERWATER_LFO_FREQUENCY_HZ;
  const underwaterDepth = ctx.createGain();
  underwaterDepth.gain.value = 0;

  const dryGain = ctx.createGain();
  const wetGain = ctx.createGain();
  const convolver = ctx.createConvolver();
  convolver.buffer = getDecayingNoiseImpulse(ctx, REVERB_SECONDS, REVERB_DECAY_SECONDS);
  const mix = ctx.createGain();

  // Listening EQ: one biquad per band, chained in series. Starts flat (0 dB) so
  // it's transparent until the user dials in a preset. Never part of the export.
  const eq = AUDIO_EFFECTS.EQUALIZER.BANDS.map((band) => {
    const filter = ctx.createBiquadFilter();
    filter.type = band.type;
    filter.frequency.value = band.frequencyHz;
    if (band.type === 'peaking') filter.Q.value = AUDIO_EFFECTS.EQUALIZER.PEAKING_Q;
    filter.gain.value = 0;
    return filter;
  });

  const panner = ctx.createStereoPanner();
  const panDepth = ctx.createGain();
  const osc = ctx.createOscillator();
  osc.type = 'sine';

  const eightDConvolver = ctx.createConvolver();
  eightDConvolver.buffer = getEightDBedImpulse(ctx);
  const eightDBed = ctx.createGain();
  eightDBed.gain.value = 0;
  const out = ctx.createGain();

  highpass.connect(lowshelf);
  lowshelf.connect(peak);
  peak.connect(underwaterLowpass);
  underwaterLowpass.connect(dryGain);
  // The convolver's input is NOT wired here: applyEffectOptions attaches it on
  // demand (reverbRouted), so a clean playback never pays for convolution.
  convolver.connect(wetGain);
  underwaterLfo.connect(underwaterDepth);
  underwaterDepth.connect(underwaterLowpass.frequency);
  underwaterLfo.start();
  dryGain.connect(mix);
  wetGain.connect(mix);
  // mix -> eq[0] -> eq[1] -> ... -> eq[last] -> panner
  const eqTail = eq.reduce<AudioNode>((prev, filter) => {
    prev.connect(filter);
    return filter;
  }, mix);
  eqTail.connect(panner);
  panner.connect(out);

  // 8D ambience bed: a constant, un-panned reverb tapped from the pre-pan mix so
  // both ears keep a quiet presence while the dry signal orbits via the panner.
  // Like the reverb convolver, its input (mix -> eightDConvolver) is attached on
  // demand by applyEffectOptions (bedRouted).
  eightDConvolver.connect(eightDBed);
  eightDBed.connect(out);

  osc.connect(panDepth);
  panDepth.connect(panner.pan);
  osc.start();

  return { input: highpass, output: out, highpass, lowshelf, peak, underwaterLowpass, underwaterLfo, underwaterDepth, dryGain, wetGain, convolver, mix, eq, panner, panDepth, osc, eightDConvolver, eightDBed, out, reverbRouted: false, bedRouted: false };
}

function setParam(param: AudioParam, value: number, ctx: AudioContext, ramp: boolean) {
  if (ramp && typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(value, ctx.currentTime, RAMP_TIME_CONSTANT);
  } else {
    param.value = value;
  }
}

/**
 * Apply effect options to a live chain. With `ramp`, parameters glide to their new
 * values; without it (at playback start) they are set instantly.
 * Speed lives on the source node and is handled by the playback hook.
 */
export function applyEffectOptions(
  chain: EffectChain,
  options: AudioProcessingOptions,
  ctx: AudioContext,
  ramp: boolean,
) {
  const reverb = Math.max(0, Math.min(1, options.reverbAmount || 0));
  const bass = options.bassBoost ? Math.max(0, Math.min(1, options.bassBoostIntensity ?? 0)) : 0;
  const eightD = !!options.audio8D;

  // Attach/detach the convolver inputs so convolution only ever runs while its
  // effect is audible. Attach happens before the gain ramps up (the wet signal
  // builds through the IR); detach lets the stored tail ring out through the
  // ramped-down wet gain - both directions are click-free.
  const reverbAudible = reverb > 0;
  if (reverbAudible !== chain.reverbRouted) {
    chain.reverbRouted = reverbAudible;
    if (reverbAudible) {
      chain.underwaterLowpass.connect(chain.convolver);
    } else {
      try {
        chain.underwaterLowpass.disconnect(chain.convolver);
      } catch {
        // already detached
      }
    }
  }
  if (eightD !== chain.bedRouted) {
    chain.bedRouted = eightD;
    if (eightD) {
      chain.mix.connect(chain.eightDConvolver);
    } else {
      try {
        chain.mix.disconnect(chain.eightDConvolver);
      } catch {
        // already detached
      }
    }
  }
  // Reverb makeup restores the loudness lost to the dry/wet crossfade; the bass
  // trim claws back the headroom the low shelf adds. Both fold into the dry/wet
  // gains (the bass filters sit before the split, so scaling dry and wet equally
  // is the same as trimming the bass-stage output) - this keeps live playback at
  // the same loudness as the offline export, which applies the identical factors.
  const levelTrim = reverbMakeupGain(reverb) * bassBoostTrimGain(bass);
  setParam(chain.dryGain.gain, (1 - reverb * 0.5) * levelTrim, ctx, ramp);
  setParam(chain.wetGain.gain, reverb * 0.5 * levelTrim, ctx, ramp);

  setParam(chain.lowshelf.gain, bass * 18, ctx, ramp);
  setParam(chain.peak.gain, -bass * 3, ctx, ramp);

  // Underwater muffle: only active within bass-boost mode. Cutoff closes as the
  // amount grows; the LFO depth scales with it, so both reach zero effect at 0.
  const underwater = options.bassBoost ? Math.max(0, Math.min(1, options.bassUnderwater ?? 0)) : 0;
  const cutoff = underwaterCutoffHz(underwater);
  setParam(chain.underwaterLowpass.frequency, cutoff, ctx, ramp);
  setParam(chain.underwaterDepth.gain, cutoff * AUDIO_EFFECTS.BASS_BOOST.UNDERWATER_LFO_DEPTH_RATIO * underwater, ctx, ramp);

  setParam(chain.panDepth.gain, eightD ? 1 : 0, ctx, ramp);
  setParam(chain.panner.pan, 0, ctx, ramp);
  // Constant ambience bed keeps both ears filled while the dry signal orbits.
  setParam(chain.eightDBed.gain, eightD ? AUDIO_SIGNAL.EIGHT_D_MIX.WET_GAIN : 0, ctx, ramp);
  // Offline maps one full rotation to 4 / rotationSpeed seconds → frequency = rotationSpeed / 4.
  setParam(chain.osc.frequency, eightD ? Math.max(0.01, (options.rotationSpeed || 0.4) / 4) : 0.01, ctx, ramp);
}

/**
 * Apply the listening-EQ gains to the live chain. Gains are dB per band, in the
 * canonical band order; missing bands fall back to 0 dB. With `ramp`, each band
 * glides to its new gain (no zipper noise); otherwise it's set instantly.
 */
export function applyEqGains(
  chain: EffectChain,
  gains: number[],
  ctx: AudioContext,
  ramp: boolean,
) {
  chain.eq.forEach((filter, i) => {
    setParam(filter.gain, gains[i] ?? 0, ctx, ramp);
  });
}

export function disconnectEffectChain(chain: EffectChain) {
  try {
    chain.osc.stop();
  } catch {
    // already stopped
  }
  try {
    chain.underwaterLfo.stop();
  } catch {
    // already stopped
  }
  for (const node of [chain.osc, chain.panDepth, chain.panner, ...chain.eq, chain.eightDConvolver, chain.eightDBed, chain.out, chain.mix, chain.wetGain, chain.dryGain, chain.convolver, chain.underwaterDepth, chain.underwaterLfo, chain.underwaterLowpass, chain.peak, chain.lowshelf, chain.highpass]) {
    try {
      node.disconnect();
    } catch {
      // ignore disconnect errors
    }
  }
}

/** Neutral options: clean playback before any effect is chosen. */
export const NEUTRAL_OPTIONS: AudioProcessingOptions = {
  speedMultiplier: 1,
  reverbAmount: 0,
  audio8D: false,
  bassBoost: false,
};
