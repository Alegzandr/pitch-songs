import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAudioExport } from './useAudioExport';
import { ERROR_MESSAGES } from '../constants';

const { mockBuffer, mockBlob, mockStrategyExport, mockGetExportStrategy, mockEstimateBitrate, mockDownload } = vi.hoisted(() => {
  return {
    mockBuffer: { duration: 2 } as unknown as AudioBuffer,
    mockBlob: new Blob(['audio'], { type: 'audio/mp3' }),
    mockStrategyExport: vi.fn(),
    mockGetExportStrategy: vi.fn(),
    mockEstimateBitrate: vi.fn(() => 192),
    mockDownload: vi.fn(),
  };
});

vi.mock('../utils/exportStrategies', () => ({
  getExportStrategy: mockGetExportStrategy.mockReturnValue({ export: mockStrategyExport }),
  estimateBitrate: mockEstimateBitrate,
}));

vi.mock('../utils/download', () => ({
  downloadBlob: mockDownload,
}));

describe('useAudioExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStrategyExport.mockResolvedValue({ blob: mockBlob, extension: 'mp3' });
  });

  const renderExportHook = (overrides: Partial<Parameters<typeof useAudioExport>[0]> = {}) =>
    renderHook(() =>
      useAudioExport({
        getBuffer: () => mockBuffer,
        originalFile: new File(['data'], 'demo.mp3', { type: 'audio/mp3' }),
        metadata: { originalFormat: 'mp3' } as any,
        getBufferDuration: (buffer) => buffer?.duration ?? 0,
        ...overrides,
      })
    );

  it('exports using strategy and downloads with derived filename', async () => {
    const { result } = renderExportHook();

    await act(async () => {
      await result.current.exportProcessedAudio({ effectLabel: 'FX' });
    });

    expect(mockGetExportStrategy).toHaveBeenCalledWith('mp3');
    expect(mockEstimateBitrate).toHaveBeenCalledWith(expect.any(File), mockBuffer.duration);
    expect(mockStrategyExport).toHaveBeenCalledWith({
      buffer: mockBuffer,
      originalFile: expect.any(File),
      estimatedBitrate: 192,
    });
    expect(mockDownload).toHaveBeenCalledWith(mockBlob, 'demo_processed FX ver. by Reverie.mp3');
    expect(result.current.state.isExporting).toBe(false);
  });

  it('uses provided filename when supplied', async () => {
    const { result } = renderExportHook();

    await act(async () => {
      await result.current.exportProcessedAudio({ filename: 'custom.wav', effectLabel: 'FX' });
    });

    expect(mockDownload).toHaveBeenCalledWith(mockBlob, 'custom FX ver. by Reverie.mp3');
  });

  it('throws and records error when no buffer is available', async () => {
    const { result } = renderExportHook({
      getBuffer: () => null,
    });

    await act(async () => {
      await expect(result.current.exportProcessedAudio()).rejects.toThrow(ERROR_MESSAGES.NO_AUDIO_TO_EXPORT);
    });

    await waitFor(() => {
      expect(result.current.state.error).toBe(ERROR_MESSAGES.NO_AUDIO_TO_EXPORT);
    });
  });

  it('handles strategy errors gracefully', async () => {
    const { result } = renderExportHook();
    mockStrategyExport.mockRejectedValueOnce(new Error('export failed'));

    await act(async () => {
      try {
        await result.current.exportProcessedAudio();
      } catch (error) {
        // expected
      }
    });

    expect(result.current.state.error).toBe('export failed');
  });

  it('does not duplicate suffix when already present', async () => {
    const { result } = renderExportHook();

    await act(async () => {
      await result.current.exportProcessedAudio({ filename: 'demo by Reverie.mp3', effectLabel: 'FX' });
    });

    expect(mockDownload).toHaveBeenCalledWith(mockBlob, 'demo FX ver. by Reverie.mp3');
  });

  it('falls back to default message for non-error failures', async () => {
    const { result } = renderExportHook();
    mockStrategyExport.mockRejectedValueOnce('fail');

    await act(async () => {
      try {
        await result.current.exportProcessedAudio();
      } catch (error) {
        // expected
      }
    });

    expect(result.current.state.error).toBe(ERROR_MESSAGES.EXPORT_FAILED);
  });
});
