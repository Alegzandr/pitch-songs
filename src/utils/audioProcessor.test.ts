import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AudioProcessor } from './audioProcessor';
import { createDecayingNoiseImpulse } from './impulse';

const OriginalAudioContext = globalThis.AudioContext;
const OriginalOfflineAudioContext = globalThis.OfflineAudioContext;

class InspectableBufferSource {
  buffer: any = null;
  playbackRate = { value: 1 };
  connect = vi.fn();
  start = vi.fn();
}

class InspectableGain {
  gain = { value: 1 };
  connect = vi.fn();
}

class InspectableConvolver {
  buffer: any = null;
  connect = vi.fn();
}

class InspectableScriptProcessor {
  onaudioprocess: any = null;
  connect = vi.fn();
  processedEvent: any = null;
}

class InspectableStereoPanner {
  pan = { value: 0, setValueAtTime: vi.fn() };
  connect = vi.fn();
}

class InspectableOfflineAudioContext {
  static lastInstance: InspectableOfflineAudioContext | null = null;
  destination = {};
  numberOfChannels: number;
  length: number;
  sampleRate: number;
  source = new InspectableBufferSource();
  convolver = new InspectableConvolver();
  dry = new InspectableGain();
  wet = new InspectableGain();
  merger = new InspectableGain();
  scriptProcessor: InspectableScriptProcessor | null = null;
  panner: InspectableStereoPanner | null = null;

  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    InspectableOfflineAudioContext.lastInstance = this;
  }

  createBufferSource() {
    return this.source;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number) {
    return new AudioBuffer({ numberOfChannels, length, sampleRate });
  }

  createConvolver() {
    return this.convolver;
  }

  createGain() {
    // alternate between dry/wet/merger gains
    const gains = [this.dry, this.wet, this.merger];
    const next = gains.find((g) => g.connect.mock.calls.length === 0) || new InspectableGain();
    return next;
  }

  createScriptProcessor() {
    this.scriptProcessor = new InspectableScriptProcessor();
    return this.scriptProcessor;
  }

  createStereoPanner() {
    this.panner = new InspectableStereoPanner();
    return this.panner;
  }

  startRendering() {
    const rendered = new AudioBuffer({ numberOfChannels: this.numberOfChannels, length: this.length, sampleRate: this.sampleRate });
    if (this.scriptProcessor?.onaudioprocess) {
      const inputBuffer = new AudioBuffer({ numberOfChannels: 2, length: 4, sampleRate: this.sampleRate });
      inputBuffer.getChannelData(0).set([0.5, -0.5, 0.25, -0.25]);
      inputBuffer.getChannelData(1).set([0.1, -0.1, 0.05, -0.05]);
      const outputBuffer = new AudioBuffer({ numberOfChannels: 2, length: 4, sampleRate: this.sampleRate });
      const event: any = { inputBuffer, outputBuffer };
      this.scriptProcessor.processedEvent = event;
      this.scriptProcessor.onaudioprocess(event as any);
    }
    return Promise.resolve(rendered as any);
  }
}

class InspectableAudioContext {
  destination = {};
  sampleRate = 44100;
  decodedBuffers: any[] = [];

  createGain() {
    return new InspectableGain();
  }

  createBufferSource() {
    return new InspectableBufferSource();
  }

  decodeAudioData(data: ArrayBuffer) {
    const size = data.byteLength / 4 || 1;
    const buffer = new AudioBuffer({ numberOfChannels: 2, length: size, sampleRate: this.sampleRate }) as any;
    this.decodedBuffers.push(buffer);
    return buffer;
  }
}

describe('audioProcessor utils', () => {
  beforeAll(() => {
    globalThis.AudioContext = InspectableAudioContext as any;
    globalThis.OfflineAudioContext = InspectableOfflineAudioContext as any;
  });

  afterAll(() => {
    globalThis.AudioContext = OriginalAudioContext;
    globalThis.OfflineAudioContext = OriginalOfflineAudioContext;
  });

  it('loads and retrieves audio buffer', async () => {
    const processor = new AudioProcessor();
    const file: any = new File(['1234'], 'sample.wav', { type: 'audio/wav' });
    file.arrayBuffer = async () => new TextEncoder().encode('1234').buffer;

    const buffer = await processor.loadAudioFile(file);

    expect(buffer).toBeDefined();
    expect(processor.getAudioBuffer()).toBe(buffer);
    expect(processor.getAudioContext()).toBeInstanceOf(InspectableAudioContext);
  });

  it('throws when processing without buffer', async () => {
    const processor = new AudioProcessor();
    await expect(processor.processAudio({ speedMultiplier: 1, reverbAmount: 0 })).rejects.toThrow('No audio file loaded');
  });

  it('applies effects and 8D audio through offline context', async () => {
    const processor: any = new AudioProcessor();
    processor.audioBuffer = new AudioBuffer({ numberOfChannels: 2, length: 8, sampleRate: 44100 });

    const rendered = await processor.processAudio({
      speedMultiplier: 1.5,
      reverbAmount: 0.4,
      audio8D: true,
      rotationSpeed: 1.0,
    });

    const offline = InspectableOfflineAudioContext.lastInstance!;
    expect(offline.length).toBe(Math.floor(8 / 1.5));
    expect(offline.source.playbackRate.value).toBeCloseTo(1.5);
    expect(offline.convolver.buffer).toBeDefined();
    expect(offline.panner).not.toBeNull();
    expect(offline.panner?.pan.setValueAtTime).toHaveBeenCalled();
    expect(rendered).toBeDefined();
  });

  it('connects directly when no effects enabled', async () => {
    const processor: any = new AudioProcessor();
    processor.audioBuffer = new AudioBuffer({ numberOfChannels: 2, length: 8, sampleRate: 44100 });

    const rendered = await processor.processAudio({
      speedMultiplier: 1,
      reverbAmount: 0,
    });

    const offline = InspectableOfflineAudioContext.lastInstance!;
    expect(offline.panner).toBeNull();
    expect(offline.source.connect).toHaveBeenCalledWith(offline.destination);
    expect(rendered).toBeDefined();
  });

  it('applies 8D audio effect with rotation speed', async () => {
    const processor: any = new AudioProcessor();
    processor.audioBuffer = new AudioBuffer({ numberOfChannels: 2, length: 8, sampleRate: 44100 });

    await processor.processAudio({
      speedMultiplier: 1,
      reverbAmount: 0,
      audio8D: true,
      rotationSpeed: 0.5,
    });

    const offline = InspectableOfflineAudioContext.lastInstance!;
    expect(offline.panner).not.toBeNull();
    expect(offline.panner?.pan.setValueAtTime).toHaveBeenCalled();
  });

  it('applies 8D audio without rotation speed parameter', async () => {
    const processor: any = new AudioProcessor();
    processor.audioBuffer = new AudioBuffer({ numberOfChannels: 2, length: 8, sampleRate: 44100 });

    await processor.processAudio({
      speedMultiplier: 1,
      reverbAmount: 0,
      audio8D: true,
    });

    const offline = InspectableOfflineAudioContext.lastInstance!;
    expect(offline.panner).not.toBeNull();
    expect(offline.panner?.pan.setValueAtTime).toHaveBeenCalled();
  });

  it('creates reverb impulse with decay', () => {
    // Same tail/decay parameters the offline renderer passes for amount 0.5.
    const ctx = new InspectableOfflineAudioContext(2, 10, 48000);
    const impulse = createDecayingNoiseImpulse(ctx as any, 1 + 0.5 * 2, 0.5);

    expect(impulse.length).toBe(48000 * (1 + 0.5 * 2));
    const data = impulse.getChannelData(0);
    expect(data[0]).not.toBe(0);
    expect(data.some((value: number) => value !== 0)).toBe(true);
  });

  it('converts audio buffer to WAV blob', async () => {
    const processor: any = new AudioProcessor();
    const buffer = new AudioBuffer({ numberOfChannels: 1, length: 2, sampleRate: 44100 });
    buffer.getChannelData(0).set([-0.5, 0.5]);
    const wav = await processor.audioBufferToWav(buffer as any);

    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(48);
  });
});
