import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAudioProcessor } from './useAudioProcessor';

const { mockAudioBuffer, mockDownload, mockAudioContext, mockAudioProcessor, mockExportStrategy, mockGetExportStrategy, mockEstimateBitrate } = vi.hoisted(() => {
  const buffer = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 });
  let storedBuffer: AudioBuffer | null = buffer;
  const download = vi.fn();
  const exportStrategy = { export: vi.fn(async () => ({ blob: new Blob(['mp3'], { type: 'audio/mp3' }), extension: 'mp3' })) };
  const getStrategy = vi.fn(() => exportStrategy);
  const estimate = vi.fn(() => 192);

  const param = (value = 0) => ({
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  const audioContext = {
    destination: {},
    currentTime: 0,
    sampleRate: 44100,
    createGain: vi.fn(() => ({ gain: param(1), connect: vi.fn(), disconnect: vi.fn() })),
    createBufferSource: vi.fn(() => {
      const node: any = { buffer: null, loop: false, playbackRate: param(1), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      return node;
    }),
    createBiquadFilter: vi.fn(() => ({ type: '', frequency: param(350), Q: param(1), gain: param(0), connect: vi.fn(), disconnect: vi.fn() })),
    createConvolver: vi.fn(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn() })),
    createStereoPanner: vi.fn(() => ({ pan: param(0), connect: vi.fn(), disconnect: vi.fn() })),
    createOscillator: vi.fn(() => ({ type: '', frequency: param(440), connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn() })),
    createBuffer: vi.fn((_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })),
  };

  const processor = {
    loadAudioFile: vi.fn(async () => buffer),
    processAudio: vi.fn(async () => buffer),
    getAudioContext: vi.fn(() => audioContext as any),
    getAudioBuffer: vi.fn(() => storedBuffer as any),
    audioBufferToWav: vi.fn(),
  };

  (processor as any).__setBuffer = (next: AudioBuffer | null) => {
    storedBuffer = next;
  };

  return {
    mockAudioBuffer: buffer,
    mockDownload: download,
    mockAudioContext: audioContext,
    mockAudioProcessor: processor,
    mockExportStrategy: exportStrategy,
    mockGetExportStrategy: getStrategy,
    mockEstimateBitrate: estimate,
  };
});

vi.mock('../utils/audioProcessor', () => ({
  audioProcessor: mockAudioProcessor,
}));

vi.mock('../utils/exportStrategies', () => ({
  getExportStrategy: mockGetExportStrategy,
  estimateBitrate: mockEstimateBitrate,
}));

vi.mock('../utils/audioMetadataExtractor', () => ({
  extractAudioMetadata: vi.fn(() => Promise.resolve({
    sampleRate: 44100,
    channels: 1,
    bitDepth: null,
  })),
}));

vi.mock('../utils/download', () => ({
  downloadBlob: mockDownload,
}));

const realRaf = globalThis.requestAnimationFrame;
const realCancelRaf = globalThis.cancelAnimationFrame;

describe('useAudioProcessor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAudioContext.createGain.mockClear();
    mockAudioContext.createBufferSource.mockClear();
    (mockAudioProcessor as any).__setBuffer(mockAudioBuffer);
    (globalThis as any).requestAnimationFrame = vi.fn(() => 0 as unknown as number);
    (globalThis as any).cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (realRaf) {
      (globalThis as any).requestAnimationFrame = realRaf;
    }
    if (realCancelRaf) {
      (globalThis as any).cancelAnimationFrame = realCancelRaf;
    }
  });

  it('loads audio file and updates state', async () => {
    const file = new File(['data'], 'track.mp3', { type: 'audio/mp3' });
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    expect(mockAudioProcessor.loadAudioFile).toHaveBeenCalledWith(file);
    expect(result.current.originalFile).toBe(file);
    expect(result.current.originalBuffer).toBe(mockAudioBuffer);
    const expectedDuration = mockAudioBuffer.length / mockAudioBuffer.sampleRate;
    expect(result.current.duration).toBeCloseTo(expectedDuration);
    expect(result.current.state.progress).toBe(100);

    // Verify metadata is set correctly
    expect(result.current.metadata).toBeDefined();
    expect(result.current.metadata?.sampleRate).toBe(mockAudioBuffer.sampleRate);
    expect(result.current.metadata?.channels).toBe(mockAudioBuffer.numberOfChannels);
    expect(typeof result.current.metadata?.bitrate).toBe('number');
    expect(result.current.metadata?.bitDepth).toBeNull(); // MP3 is lossy, no bit depth
  });

  it('handles load errors', async () => {
    mockAudioProcessor.loadAudioFile.mockRejectedValueOnce(new Error('fail'));
    const { result } = renderHook(() => useAudioProcessor());
    const file = new File(['data'], 'broken.mp3', { type: 'audio/mp3' });

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    expect(result.current.state.error).toBe('Failed to load audio file: fail');
  });

  it('handles load errors with non-error types', async () => {
    mockAudioProcessor.loadAudioFile.mockRejectedValueOnce('bad');
    const { result } = renderHook(() => useAudioProcessor());
    const file = new File(['data'], 'broken.mp3', { type: 'audio/mp3' });

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    expect(result.current.state.error).toBe('Failed to load audio file');
  });

  it('detects bit depth for lossless formats', async () => {
    mockAudioProcessor.loadAudioFile.mockResolvedValueOnce(mockAudioBuffer);
    const { result } = renderHook(() => useAudioProcessor());

    // Create a mock WAV file with size for 16-bit audio
    // File size = header (44 bytes) + (sampleRate * channels * bytesPerSample * duration)
    const duration = mockAudioBuffer.length / mockAudioBuffer.sampleRate;
    const sampleRate = mockAudioBuffer.sampleRate;
    const channels = mockAudioBuffer.numberOfChannels;
    const bytesPerSample = 2; // 16-bit = 2 bytes
    const fileSize = 44 + (sampleRate * channels * bytesPerSample * duration);
    const file = new File([new ArrayBuffer(Math.floor(fileSize))], 'test.wav', { type: 'audio/wav' });

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    expect(result.current.metadata?.bitDepth).toBe(16);
  });

  it('processes audio with progress updates', async () => {
    vi.useFakeTimers();
    mockAudioProcessor.processAudio.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(mockAudioBuffer), 200)));
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      const promise = result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
      await vi.advanceTimersByTimeAsync(250);
      await promise;
    });

    expect(mockAudioProcessor.processAudio).toHaveBeenCalled();
    expect(result.current.processedBuffer).toBe(mockAudioBuffer);
    expect(result.current.duration).toBeCloseTo(mockAudioBuffer.length / mockAudioBuffer.sampleRate);
    expect(result.current.playbackClock.get()).toBe(0);
    expect(result.current.state.progress).toBe(100);
    expect(result.current.state.isProcessing).toBe(false);
  });

  it('sets error on process failure', async () => {
    vi.useFakeTimers();
    mockAudioProcessor.processAudio.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      try {
        await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
      } catch (e) {
        // expected
      }
    });

    expect(result.current.state.error).toBe('boom');
    expect(result.current.state.isProcessing).toBe(false);
  });

  it('sets fallback message on non-error process failure', async () => {
    vi.useFakeTimers();
    mockAudioProcessor.processAudio.mockRejectedValueOnce('bad');
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      try {
        await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
      } catch (e) {
        // expected
      }
    });

    expect(result.current.state.error).toBe('Failed to process audio');
  });

  it('plays and stops audio with gain control', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;
    const gain = mockAudioContext.createGain.mock.results[0].value;

    expect(source.start).toHaveBeenCalledWith(0, 0);
    expect(gain.gain.value).toBeCloseTo(0.7);
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.playbackClock.get()).toBe(0);

    act(() => {
      result.current.updateVolume(0.3);
    });

    expect(gain.gain.value).toBe(0.3);

    act(() => {
      result.current.stopAudio();
    });

    expect(source.stop).toHaveBeenCalled();
    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.playbackClock.get()).toBeCloseTo(0);
  });

  it('swallows stop errors while switching sources', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    const firstSource = mockAudioContext.createBufferSource.mock.results[0].value;
    firstSource.stop.mockImplementation(() => {
      throw new Error('stopped');
    });

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    expect(firstSource.stop).toHaveBeenCalled();
  });

  it('swallows stop errors when stopping playback', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;
    source.stop.mockImplementation(() => {
      throw new Error('stopped');
    });

    act(() => {
      result.current.stopAudio();
    });

    expect(source.stop).toHaveBeenCalled();
  });

  it('sets error when attempting to play without buffer', () => {
    const { result } = renderHook(() => useAudioProcessor());
    (mockAudioProcessor as any).__setBuffer(null);

    act(() => {
      result.current.playAudio();
    });

    expect(result.current.state.error).toBe('No audio to play');
  });

  it('exports using strategy and derived bitrate', async () => {
    const { result } = renderHook(() => useAudioProcessor());
    const file = new File(['data'.repeat(1024)], 'demo.mp3', { type: 'audio/mp3' });

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    await act(async () => {
      await result.current.exportProcessedAudio();
    });

    expect(mockGetExportStrategy).toHaveBeenCalledWith('mp3');
    expect(mockEstimateBitrate).toHaveBeenCalledWith(file, expect.any(Number));
    expect(mockExportStrategy.export).toHaveBeenCalledWith({
      buffer: mockAudioBuffer,
      originalFile: file,
      estimatedBitrate: 192,
    });
    expect(mockDownload).toHaveBeenCalledWith(expect.any(Blob), 'demo_processed ver. by Reverie.mp3');
    expect(result.current.state.isExporting).toBe(false);
  });

  it('exports with target extension when strategy changes format', async () => {
    const { result } = renderHook(() => useAudioProcessor());
    const file = new File(['data'], 'demo.wav', { type: 'audio/wav' });
    mockExportStrategy.export.mockResolvedValueOnce({
      blob: new Blob(['wav'], { type: 'audio/wav' }),
      extension: 'wav',
    });

    await act(async () => {
      await result.current.loadAudioFile(file);
    });

    await act(async () => {
      await result.current.exportProcessedAudio();
    });

    expect(mockGetExportStrategy).toHaveBeenCalledWith('wav');
    expect(mockDownload).toHaveBeenCalledWith(expect.any(Blob), 'demo_processed ver. by Reverie.wav');
  });

  it('exports with fallback filename when no original file', async () => {
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
    });

    await act(async () => {
      await result.current.exportProcessedAudio();
    });

    expect(mockDownload).toHaveBeenCalledWith(expect.any(Blob), 'processed_audio ver. by Reverie.mp3');
  });

  it('throws when exporting without audio and records error', async () => {
    const { result } = renderHook(() => useAudioProcessor());
    (mockAudioProcessor as any).__setBuffer(null);

    await act(async () => {
      await expect(result.current.exportProcessedAudio()).rejects.toThrow('No audio to export');
    });
  });

  it('handles export errors', async () => {
    mockExportStrategy.export.mockRejectedValueOnce(new Error('export fail'));
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
    });

    await act(async () => {
      try {
        await result.current.exportProcessedAudio('custom.mp3');
      } catch (e) {
        // expected
      }
    });

    expect(result.current.state.error).toBe('export fail');
  });

  it('handles export errors with non-error values', async () => {
    mockExportStrategy.export.mockRejectedValueOnce('fail');
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
    });

    await act(async () => {
      try {
        await result.current.exportProcessedAudio('custom.mp3');
      } catch (e) {
        // expected
      }
    });

    expect(result.current.state.error).toBe('Failed to export audio');
  });

  it('seeks while paused and updates playhead', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.seekTo(0.5);
    });

    expect(result.current.playbackClock.get()).toBeCloseTo(0.5);
  });

  it('restarts playback when seeking during preview', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    act(() => {
      result.current.seekTo(0.25);
    });

    const secondSource = mockAudioContext.createBufferSource.mock.results[1].value;
    expect(secondSource.start).toHaveBeenCalledWith(0, expect.any(Number));
  });

  it('ignores stale onended callbacks after restart', () => {
    const { result } = renderHook(() => useAudioProcessor());

    act(() => {
      result.current.playAudio(mockAudioBuffer);
    });

    const firstSource = mockAudioContext.createBufferSource.mock.results[0].value;

    act(() => {
      result.current.playAudio(mockAudioBuffer, 0.5);
    });

    act(() => {
      firstSource.onended?.();
    });

    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.playbackClock.get()).toBeCloseTo(0.5);
  });

  // Regression: an inline `getAudioContext` passed to useAudioPlayback used to change
  // identity every render, cascading through captureProgress → setEffects into App's
  // handleEffectChange. EffectControls lists that onChange in a useEffect dependency
  // array, so an unstable identity re-ran the effect every render - an infinite
  // re-render loop in the editor that surfaced as "Maximum update depth exceeded"
  // the moment a dialog mounted. The returned callbacks must stay referentially stable.
  it('returns referentially stable callbacks across re-renders', () => {
    const { result, rerender } = renderHook(() => useAudioProcessor());

    const first = {
      setEffects: result.current.setEffects,
      playAudio: result.current.playAudio,
      stopAudio: result.current.stopAudio,
      seekTo: result.current.seekTo,
      updateVolume: result.current.updateVolume,
    };

    rerender();
    rerender();

    expect(result.current.setEffects).toBe(first.setEffects);
    expect(result.current.playAudio).toBe(first.playAudio);
    expect(result.current.stopAudio).toBe(first.stopAudio);
    expect(result.current.seekTo).toBe(first.seekTo);
    expect(result.current.updateVolume).toBe(first.updateVolume);
  });

  it('resets processing state and buffer', async () => {
    const { result } = renderHook(() => useAudioProcessor());

    await act(async () => {
      await result.current.loadAudioFile(new File(['data'], 'clip.mp3', { type: 'audio/mp3' }));
      await result.current.processAudio({ speedMultiplier: 1, reverbAmount: 0 });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.originalFile).toBeNull();
    expect(result.current.processedBuffer).toBeNull();
    expect(result.current.metadata).toBeNull();
    expect(result.current.state.progress).toBe(0);
    expect(result.current.duration).toBe(0);
    expect(result.current.playbackClock.get()).toBe(0);
  });
});
