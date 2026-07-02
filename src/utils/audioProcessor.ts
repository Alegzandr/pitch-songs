import { AUDIO_EFFECTS, AUDIO_SIGNAL, EFFECT_DEFAULTS, NIGHTCORE } from '../constants';
import { underwaterCutoffHz, reverbMakeupGain, bassBoostTrimGain } from './dsp';
import { getDecayingNoiseImpulse, getEightDBedImpulse } from './impulse';
import { BinaryWriter } from './binary';
import { interleaveToInt16 } from './pcm';
import { loadBeatSamples, type BeatRole } from './beatSamples';
import { beatRoles, beatOnsetTimes } from './beatScheduler';

export interface AudioProcessingOptions {
  speedMultiplier: number;
  reverbAmount: number;
  audio8D?: boolean; // 8D spatial audio effect
  rotationSpeed?: number; // Speed of 8D rotation (0.1 - 2.0)
  bassBoost?: boolean; // Bass boost effect
  bassBoostIntensity?: number; // Bass boost intensity (0.0 - 1.0)
  bassUnderwater?: number; // Underwater muffle amount within bass boost (0.0 - 1.0)
  // Nightcore beat bed (Speed Up only). enable/volume are user choices; bpm and
  // beatOffsetSec are the track's detected tempo, injected by the processor hook so
  // the same grid drives live playback and the offline export.
  enableBeats?: boolean; // Layer a percussion bed under the speed-up
  beatsVolume?: number; // Beat-bed level, independent of master volume (0.0 - 1.0)
  bpm?: number; // Detected tempo for the beat grid
  beatOffsetSec?: number; // Seconds to the first downbeat of the grid
  beatsPerBar?: 3 | 4; // Detected meter (waltz vs common time) for the beat pattern
}

/**
 * Audio Processor
 *
 * Handles all audio processing operations including loading, effects processing,
 * and format conversion using the Web Audio API.
 */
export class AudioProcessor {
  // Created lazily on first use (see getAudioContext): constructing an AudioContext
  // at module load spins up the audio hardware on every page visit - including the
  // welcome/desktop-gate screens where audio never plays - and trips a browser
  // warning about contexts created before a user gesture.
  private audioContext: AudioContext | null = null;
  private audioBuffer: AudioBuffer | null = null;

  /**
   * Load an audio file and decode it into an AudioBuffer
   *
   * @param file - The audio file to load
   * @returns Promise that resolves to the decoded AudioBuffer
   * @throws Error if file cannot be decoded or is not a valid audio file
   */
  async loadAudioFile(file: File): Promise<AudioBuffer> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      this.audioBuffer = await this.getAudioContext().decodeAudioData(arrayBuffer);
      return this.audioBuffer;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to load audio file: ${message}`);
    }
  }

  /**
   * Process audio with various effects (speed, reverb, 8D spatial, bass boost)
   *
   * @param options - Processing options including speed, reverb, and effects
   * @returns Promise that resolves to the processed AudioBuffer
   * @throws Error if no audio file is loaded or processing fails
   */
  async processAudio(options: AudioProcessingOptions): Promise<AudioBuffer> {
    if (!this.audioBuffer) {
      throw new Error('No audio file loaded');
    }

    try {

    const { speedMultiplier, reverbAmount, audio8D, rotationSpeed, bassBoost, bassBoostIntensity, bassUnderwater } = options;

    // Create offline context for processing
    const offlineContext = new OfflineAudioContext(
      this.audioBuffer.numberOfChannels,
      Math.floor(this.audioBuffer.length / speedMultiplier),
      this.audioBuffer.sampleRate
    );

    // Create source node
    const source = offlineContext.createBufferSource();
    source.buffer = this.audioBuffer;
    source.playbackRate.value = speedMultiplier;

    let lastNode: AudioNode = source;

    // Add reverb if needed
    if (reverbAmount > 0) {
      const convolver = offlineContext.createConvolver();
      // Tail length and decay both scale with the amount, so more reverb also
      // means a longer, slower tail.
      convolver.buffer = getDecayingNoiseImpulse(
        offlineContext,
        1 + reverbAmount * AUDIO_EFFECTS.REVERB.DECAY_RATE,
        reverbAmount,
      );

      const dry = offlineContext.createGain();
      const wet = offlineContext.createGain();

      // Makeup gain restores the loudness the dry/wet crossfade removes (see
      // reverbMakeupGain); without it the mix drops up to ~5 dB at full reverb.
      const makeup = reverbMakeupGain(reverbAmount);
      dry.gain.value = (1 - reverbAmount * 0.5) * makeup;
      wet.gain.value = reverbAmount * 0.5 * makeup;

      source.connect(dry);
      source.connect(convolver);
      convolver.connect(wet);

      const merger = offlineContext.createGain();
      dry.connect(merger);
      wet.connect(merger);

      lastNode = merger;
    }

    // Apply bass boost if enabled
    if (bassBoost && bassBoostIntensity !== undefined) {
      const bassBoostNode = this.createBassBoostEffect(offlineContext, bassBoostIntensity, bassUnderwater ?? 0);
      lastNode.connect(bassBoostNode.input);
      lastNode = bassBoostNode.output;
    }

    // Apply 8D spatial audio effect if enabled
    if (audio8D) {
      const audio8DProcessor = this.create8DAudioEffect(offlineContext, this.audioBuffer, rotationSpeed || 0.5);
      lastNode.connect(audio8DProcessor.input);
      audio8DProcessor.output.connect(offlineContext.destination);
    } else {
      lastNode.connect(offlineContext.destination);
    }

    // Bake the Nightcore beat bed so the export matches what was auditioned. Scheduled
    // straight into the offline destination (in parallel to the music), on the same
    // sped-up grid the live scheduler uses. Best-effort: a sample load failure leaves
    // the export untouched rather than aborting it.
    await this.scheduleOfflineBeats(offlineContext, options);

    source.start(0);

      return await offlineContext.startRendering();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to process audio: ${message}`);
    }
  }

  /**
   * Bake the Nightcore beat bed into the offline render. Mirrors the live scheduler's
   * grid (per detected meter, crash every 4 bars, samples aligned to their attack) but
   * on the offline timeline: song time maps to output time by dividing by the speed
   * multiplier, so the grid lands at the same sped-up tempo the user auditioned.
   */
  private async scheduleOfflineBeats(
    offlineContext: OfflineAudioContext,
    options: AudioProcessingOptions,
  ): Promise<void> {
    const bpm = options.bpm ?? 0;
    if (!options.enableBeats || bpm <= 0) return;

    let samples;
    try {
      samples = await loadBeatSamples(this.getAudioContext());
    } catch {
      return; // samples unavailable - export the music without the bed
    }

    const speed = options.speedMultiplier || 1;
    const beatOffsetSec = Math.max(0, options.beatOffsetSec ?? 0);
    const beatsPerBar = options.beatsPerBar ?? 4;
    const outputDuration = offlineContext.length / offlineContext.sampleRate;

    const beatsGain = offlineContext.createGain();
    beatsGain.gain.value = options.beatsVolume ?? EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_DEFAULT;
    beatsGain.connect(offlineContext.destination);

    const roleGains = {} as Record<BeatRole, GainNode>;
    (Object.keys(NIGHTCORE.ROLE_GAINS) as BeatRole[]).forEach((role) => {
      const gain = offlineContext.createGain();
      gain.gain.value = NIGHTCORE.ROLE_GAINS[role];
      gain.connect(beatsGain);
      roleGains[role] = gain;
    });

    const fire = (role: BeatRole, when: number) => {
      const sample = samples![role];
      const src = offlineContext.createBufferSource();
      src.buffer = sample.buffer;
      src.connect(roleGains[role]);
      // Start early by the sample's attack so the transient - not the buffer head -
      // lands on the beat, matching the live scheduler. Clamped to the render start.
      src.start(Math.max(0, when - sample.attackOffsetSec));
    };

    // Beat times on the sped-up output timeline (effective tempo = bpm × speed).
    beatOnsetTimes(bpm, beatOffsetSec, speed, outputDuration).forEach((when, index) => {
      for (const role of beatRoles(index, beatsPerBar)) fire(role, when);
    });
  }

  /** Offline 8D: a dry signal that orbits the head over a constant reverb bed. */
  private create8DAudioEffect(
    context: OfflineAudioContext,
    sourceBuffer: AudioBuffer,
    rotationSpeed: number
  ): { input: GainNode; output: GainNode } {
    const duration = sourceBuffer.duration;
    const inputGain = context.createGain();
    const outputGain = context.createGain();
    const panner = context.createStereoPanner();

    const convolver = context.createConvolver();
    convolver.buffer = getEightDBedImpulse(context);
    const dryGain = context.createGain();
    const wetGain = context.createGain();
    dryGain.gain.value = AUDIO_SIGNAL.EIGHT_D_MIX.DRY_GAIN;
    wetGain.gain.value = AUDIO_SIGNAL.EIGHT_D_MIX.WET_GAIN;

    // Only the DRY path is panned, so the music orbits the head. The reverb bed
    // taps the UN-panned input so its tail stays in both ears; feeding it from the
    // panner instead would rotate a pocket of silence opposite the music.
    inputGain.connect(panner);
    panner.connect(dryGain);
    inputGain.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(outputGain);
    wetGain.connect(outputGain);

    const cycleTime = 4 / rotationSpeed; // seconds per full rotation
    const pointsPerSecond = AUDIO_EFFECTS.EIGHT_D.AUTOMATION_POINTS_PER_SECOND;
    const totalPoints = Math.ceil(duration * pointsPerSecond);

    panner.pan.setValueAtTime(0, 0);
    for (let i = 1; i <= totalPoints; i++) {
      const time = i / pointsPerSecond;
      if (time > duration) break;
      const angle = (time / cycleTime) * Math.PI * 2;
      panner.pan.linearRampToValueAtTime(Math.sin(angle), time);
    }

    return { input: inputGain, output: outputGain };
  }

  /** Bass boost: highpass (cut rumble) → lowshelf (boost) → peaking (de-mud) →
   *  optional underwater lowpass, with makeup gain. */
  private createBassBoostEffect(
    context: OfflineAudioContext,
    intensity: number,
    underwater: number
  ): { input: GainNode; output: GainNode } {
    const inputGain = context.createGain();
    const outputGain = context.createGain();

    const lowshelf = context.createBiquadFilter();
    lowshelf.type = 'lowshelf';
    lowshelf.frequency.value = AUDIO_EFFECTS.BASS_BOOST.LOWSHELF_FREQUENCY_HZ;
    lowshelf.gain.value = intensity * 18; // up to +18 dB

    const highpass = context.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = AUDIO_EFFECTS.BASS_BOOST.HIGHPASS_FREQUENCY_HZ;
    highpass.Q.value = 0.7;

    const lowMidCut = context.createBiquadFilter();
    lowMidCut.type = 'peaking';
    lowMidCut.frequency.value = AUDIO_EFFECTS.BASS_BOOST.PEAKING_FREQUENCY_HZ;
    lowMidCut.Q.value = 1.0;
    lowMidCut.gain.value = Math.min(0, -intensity * 3);

    // Trim output as the boost grows so the extra low end keeps headroom. The trim
    // is quadratic (the shelf's loudness gain accelerates with intensity); see
    // bassBoostTrimGain for how the 0.4 coefficient was measured.
    outputGain.gain.value = bassBoostTrimGain(intensity);

    inputGain.connect(highpass);
    highpass.connect(lowshelf);
    lowshelf.connect(lowMidCut);

    // Underwater muffle: a lowpass that closes as the amount grows, its cutoff
    // wobbling on a slow LFO so the sound breathes like it's submerged. Only wired
    // when the amount is non-zero, otherwise the chain stays exactly as before.
    let tail: AudioNode = lowMidCut;
    if (underwater > 0) {
      const cutoff = underwaterCutoffHz(underwater);
      const lowpass = context.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = cutoff;
      lowpass.Q.value = 0.7;

      const lfo = context.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = AUDIO_EFFECTS.BASS_BOOST.UNDERWATER_LFO_FREQUENCY_HZ;
      const lfoDepth = context.createGain();
      lfoDepth.gain.value = cutoff * AUDIO_EFFECTS.BASS_BOOST.UNDERWATER_LFO_DEPTH_RATIO * underwater;
      lfo.connect(lfoDepth);
      lfoDepth.connect(lowpass.frequency);
      lfo.start(0);

      lowMidCut.connect(lowpass);
      tail = lowpass;
    }
    tail.connect(outputGain);

    return { input: inputGain, output: outputGain };
  }

  /** Convert an AudioBuffer to a standard 16-bit PCM WAV file. */
  async audioBufferToWav(audioBuffer: AudioBuffer): Promise<Blob> {
    const { HEADER_SIZE, PCM_FORMAT, FMT_CHUNK_SIZE, BITS_PER_SAMPLE } = AUDIO_SIGNAL.WAV_FORMAT;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const bytesPerFrame = numberOfChannels * 2;
    const dataSize = audioBuffer.length * bytesPerFrame;

    const buffer = new ArrayBuffer(HEADER_SIZE + dataSize);
    const writer = new BinaryWriter(buffer, true);

    writer.ascii('RIFF');
    writer.u32(HEADER_SIZE - 8 + dataSize);
    writer.ascii('WAVE');

    writer.ascii('fmt ');
    writer.u32(FMT_CHUNK_SIZE);
    writer.u16(PCM_FORMAT);
    writer.u16(numberOfChannels);
    writer.u32(audioBuffer.sampleRate);
    writer.u32(audioBuffer.sampleRate * bytesPerFrame);
    writer.u16(bytesPerFrame);
    writer.u16(BITS_PER_SAMPLE);

    writer.ascii('data');
    writer.u32(dataSize);

    const pcm = interleaveToInt16(audioBuffer);
    for (let i = 0; i < pcm.length; i++) {
      writer.i16(pcm[i]);
    }

    return new Blob([buffer], { type: 'audio/wav' });
  }

  getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
    }
    return this.audioContext;
  }

  getAudioBuffer(): AudioBuffer | null {
    return this.audioBuffer;
  }
}

export const audioProcessor = new AudioProcessor();
