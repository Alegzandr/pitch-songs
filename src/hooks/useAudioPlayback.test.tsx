import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAudioPlayback } from './useAudioPlayback';
import { AUDIO_PROCESSING, ERROR_MESSAGES } from '../constants';

const mockBuffer = {
  duration: 2,
  sampleRate: 44100,
  length: 88200,
  numberOfChannels: 2,
} as unknown as AudioBuffer;

describe('useAudioPlayback', () => {
  let mockAudioContext: any;
  let rafSpy: any;
  let cancelRafSpy: any;

  const renderPlayback = (overrides: Partial<Parameters<typeof useAudioPlayback>[0]> = {}) =>
    renderHook(() =>
      useAudioPlayback({
        getAudioContext: () => mockAudioContext as AudioContext,
        getBufferDuration: (buffer) => buffer?.duration ?? 0,
        getFallbackBuffer: () => mockBuffer,
        ...overrides,
      })
    );

  const mockParam = (value = 0) => ({
    value,
    setValueAtTime: vi.fn(),
    setTargetAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    cancelScheduledValues: vi.fn(),
  });

  beforeEach(() => {
    mockAudioContext = {
      currentTime: 0,
      sampleRate: 44100,
      destination: {},
      createGain: vi.fn(() => ({
        gain: mockParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createBufferSource: vi.fn(() => ({
        buffer: null,
        loop: false,
        playbackRate: mockParam(1),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      })),
      createBiquadFilter: vi.fn(() => ({
        type: '',
        frequency: mockParam(350),
        Q: mockParam(1),
        gain: mockParam(0),
        connect: vi.fn(),
        disconnect: vi.fn(),
      })),
      createConvolver: vi.fn(() => ({ buffer: null, connect: vi.fn(), disconnect: vi.fn() })),
      createStereoPanner: vi.fn(() => ({ pan: mockParam(0), connect: vi.fn(), disconnect: vi.fn() })),
      createOscillator: vi.fn(() => ({
        type: '',
        frequency: mockParam(440),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      })),
      createBuffer: vi.fn((_channels: number, length: number) => ({
        getChannelData: () => new Float32Array(length),
      })),
    };

    rafSpy = vi.fn(() => 1 as unknown as number);
    cancelRafSpy = vi.fn();
    (globalThis as any).requestAnimationFrame = rafSpy;
    (globalThis as any).cancelAnimationFrame = cancelRafSpy;
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('initializes with default playback state', () => {
    const { result } = renderPlayback();

    expect(result.current.state.isPlaying).toBe(false);
    expect(result.current.playbackClock.get()).toBe(0);
    expect(result.current.state.duration).toBe(0);
    expect(result.current.state.volume).toBeCloseTo(AUDIO_PROCESSING.DEFAULT_VOLUME);
  });

  it('attaches buffer and updates duration', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.attachBuffer(mockBuffer);
    });

    expect(result.current.state.duration).toBeCloseTo(mockBuffer.duration);
    expect(result.current.playbackClock.get()).toBe(0);
  });

  it('plays audio with provided buffer and updates state', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;
    const gain = mockAudioContext.createGain.mock.results[0].value;

    expect(source.start).toHaveBeenCalledWith(0, 0);
    expect(gain.gain.value).toBeCloseTo(AUDIO_PROCESSING.DEFAULT_VOLUME);
    expect(result.current.state.isPlaying).toBe(true);
    expect(result.current.state.duration).toBeCloseTo(mockBuffer.duration);
  });

  it('updates volume and persists preference', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    act(() => {
      result.current.updateVolume(0.3);
    });

    const gain = mockAudioContext.createGain.mock.results[0].value;
    expect(gain.gain.value).toBeCloseTo(0.3);
    expect(localStorage.getItem(AUDIO_PROCESSING.VOLUME_STORAGE_KEY)).toBe('0.3');
  });

  it('stops playback and clears playing state', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;

    act(() => {
      result.current.stopAudio();
    });

    expect(source.stop).toHaveBeenCalled();
    expect(cancelRafSpy).toHaveBeenCalled();
    expect(result.current.state.isPlaying).toBe(false);
  });

  it('seeks while paused and updates playhead', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.attachBuffer(mockBuffer);
      result.current.seekTo(1);
    });

    expect(result.current.playbackClock.get()).toBeCloseTo(1);
  });

  it('restarts playback when seeking during play', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const firstSource = mockAudioContext.createBufferSource.mock.results[0].value;

    act(() => {
      result.current.seekTo(0.5);
    });

    expect(firstSource.stop).toHaveBeenCalled();
    const secondSource = mockAudioContext.createBufferSource.mock.results[1].value;
    expect(secondSource.start).toHaveBeenCalled();
    const [, offset] = secondSource.start.mock.calls[0] as unknown as [number, number];
    expect(offset).toBeCloseTo(0.5);
    expect(result.current.playbackClock.get()).toBeCloseTo(0.5);
  });

  it('loops from the top when repeat is armed and the track ends', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.toggleRepeat();
    });
    expect(result.current.state.repeat).toBe(true);

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const firstSource = mockAudioContext.createBufferSource.mock.results[0].value;

    // Simulate the buffer reaching its natural end.
    act(() => {
      firstSource.onended();
    });

    // A fresh source is started from offset 0, and playback stays live.
    const secondSource = mockAudioContext.createBufferSource.mock.results[1].value;
    expect(secondSource.start).toHaveBeenCalledWith(0, 0);
    expect(result.current.state.isPlaying).toBe(true);
  });

  it('persists the repeat preference and restores it on a fresh mount', () => {
    const { result, unmount } = renderPlayback();

    act(() => {
      result.current.toggleRepeat();
    });
    expect(localStorage.getItem(AUDIO_PROCESSING.REPEAT_STORAGE_KEY)).toBe('true');

    unmount();

    const { result: restored } = renderPlayback();
    expect(restored.current.state.repeat).toBe(true);
  });

  it('stops at the end when repeat is off', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;

    act(() => {
      source.onended();
    });

    expect(result.current.state.isPlaying).toBe(false);
    expect(mockAudioContext.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('sets error when attempting to play without a buffer', () => {
    const { result } = renderPlayback({
      getFallbackBuffer: () => null,
    });

    act(() => {
      result.current.playAudio();
    });

    expect(result.current.state.error).toBe(ERROR_MESSAGES.NO_AUDIO_TO_PLAY);
  });

  it('ramps the playback rate when effects change during play', () => {
    const { result } = renderPlayback();

    act(() => {
      result.current.playAudio(mockBuffer);
    });

    const source = mockAudioContext.createBufferSource.mock.results[0].value;

    act(() => {
      result.current.setEffects({ speedMultiplier: 1.5, reverbAmount: 0.4 });
    });

    expect(source.playbackRate.setTargetAtTime).toHaveBeenCalled();
  });

  it('stores effects while paused without throwing', () => {
    const { result } = renderPlayback();

    expect(() =>
      act(() => {
        result.current.setEffects({ speedMultiplier: 1.2, reverbAmount: 0 });
      })
    ).not.toThrow();
  });
});
