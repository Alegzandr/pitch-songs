/**
 * useAudioFile Hook
 *
 * Handles audio file loading, metadata extraction, and processing.
 * Extracted from useAudioProcessor for better separation of concerns.
 */

import { useState, useCallback } from 'react';
import { audioProcessor } from '../utils/audioProcessor';
import type { AudioProcessingOptions } from '../utils/audioProcessor';
import { extractAudioMetadata } from '../utils/audioMetadataExtractor';
import { AUDIO_PROCESSING, BIT_DEPTH, ERROR_MESSAGES, FILE_FORMATS } from '../constants';

export interface AudioFileState {
  isLoading: boolean;
  isProcessing: boolean;
  progress: number;
  error: string | null;
}

export interface AudioMetadata {
  sampleRate: number;
  channels: number;
  bitrate: number | null;
  bitDepth: number | null;
  originalFormat: string;
  originalMimeType: string;
}

export interface UseAudioFileReturn {
  state: AudioFileState;
  originalFile: File | null;
  originalBuffer: AudioBuffer | null;
  processedBuffer: AudioBuffer | null;
  metadata: AudioMetadata | null;
  loadAudioFile: (file: File) => Promise<AudioBuffer | undefined>;
  processAudio: (options: AudioProcessingOptions) => Promise<AudioBuffer>;
  reset: () => void;
  getBufferDuration: (buffer: AudioBuffer | null) => number;
}

/**
 * Hook for managing audio file loading and processing
 */
export function useAudioFile(): UseAudioFileReturn {
  const [state, setState] = useState<AudioFileState>({
    isLoading: false,
    isProcessing: false,
    progress: 0,
    error: null,
  });

  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);

  const getBufferDuration = useCallback((buffer: AudioBuffer | null) => {
    if (!buffer) return 0;
    return buffer.duration || buffer.length / buffer.sampleRate;
  }, []);

  const estimateBitDepth = useCallback((format: string, fileSize: number, duration: number, channels: number, sampleRate: number): number | null => {
    // Only lossless formats have meaningful bit depth
    if (!BIT_DEPTH.LOSSLESS_FORMATS.includes(format as typeof BIT_DEPTH.LOSSLESS_FORMATS[number]) || duration <= 0) {
      return null;
    }

    // For WAV/AIFF: Calculate from file size
    const headerSize = format.includes('aif') ? 54 : 44;
    const dataSize = fileSize - headerSize;
    const bytesPerSample = dataSize / (sampleRate * channels * duration);
    const estimatedBitDepth = Math.round(bytesPerSample * 8);

    // Round to nearest common bit depth
    if (estimatedBitDepth <= BIT_DEPTH.BOUNDARIES.EIGHT_BIT) return 8;
    if (estimatedBitDepth <= BIT_DEPTH.BOUNDARIES.SIXTEEN_BIT) return 16;
    if (estimatedBitDepth <= BIT_DEPTH.BOUNDARIES.TWENTY_FOUR_BIT) return 24;
    return 32;
  }, []);

  const loadAudioFile = useCallback(async (file: File) => {
    // Reject oversized files up front: decoding is in-memory, so a huge file can
    // OOM the tab. Guarded here (the single choke point for both the drag-drop
    // and browse paths) rather than per UI surface.
    if (file.size > FILE_FORMATS.MAX_FILE_SIZE_BYTES) {
      const maxMb = Math.round(FILE_FORMATS.MAX_FILE_SIZE_BYTES / (1024 * 1024));
      setState((prev) => ({ ...prev, isLoading: false, error: ERROR_MESSAGES.FILE_TOO_LARGE(maxMb) }));
      return;
    }

    setState((prev) => ({ ...prev, isLoading: true, error: null, progress: 0 }));
    try {
      // Header metadata is read BEFORE decoding: decode normalizes the stream and
      // loses the original sample rate / bit depth.
      const rawMetadata = await extractAudioMetadata(file);

      const buffer = await audioProcessor.loadAudioFile(file);
      const bufferDuration = getBufferDuration(buffer);

      const originalFormat = file.name.split('.').pop()?.toLowerCase() || '';
      const originalMimeType = file.type || '';

      // Prefer header metadata; fall back to the decoded buffer.
      const sampleRate = rawMetadata.sampleRate || buffer.sampleRate;
      const channels = rawMetadata.channels || buffer.numberOfChannels;
      const bitDepth = rawMetadata.bitDepth || estimateBitDepth(originalFormat, file.size, bufferDuration, channels, sampleRate);

      const bitrateKbps = bufferDuration > 0
        ? Math.round((file.size * 8) / bufferDuration / 1000)
        : null;

      setOriginalFile(file);
      setOriginalBuffer(buffer);
      // Drop any stale processed render of the PREVIOUS track: getPlaybackBuffer
      // prefers processedBuffer, so keeping it would both leak a full AudioBuffer
      // and shadow the freshly-loaded original.
      setProcessedBuffer(null);
      setMetadata({ sampleRate, channels, bitrate: bitrateKbps, bitDepth, originalFormat, originalMimeType });
      setState((prev) => ({ ...prev, isLoading: false, progress: 100 }));
      return buffer;
    } catch (error) {
      const message = error instanceof Error
        ? `${ERROR_MESSAGES.LOAD_FAILED}: ${error.message}`
        : ERROR_MESSAGES.LOAD_FAILED;
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: message,
      }));
    }
  }, [getBufferDuration, estimateBitDepth]);

  const processAudio = useCallback(async (options: AudioProcessingOptions) => {
    setState((prev) => ({ ...prev, isProcessing: true, error: null, progress: 0 }));

    // Animates the progress bar while the (non-reporting) offline render runs.
    const progressInterval = setInterval(() => {
      setState((prev) => ({
        ...prev,
        progress: Math.min(prev.progress + 10, AUDIO_PROCESSING.PROGRESS_MAX_BEFORE_COMPLETE),
      }));
    }, AUDIO_PROCESSING.PROGRESS_UPDATE_INTERVAL_MS);

    try {
      const buffer = await audioProcessor.processAudio(options);
      setProcessedBuffer(buffer);
      setState((prev) => ({ ...prev, isProcessing: false, progress: 100 }));
      return buffer;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: error instanceof Error ? error.message : ERROR_MESSAGES.PROCESS_FAILED,
      }));
      throw error;
    } finally {
      clearInterval(progressInterval);
    }
  }, []);

  const reset = useCallback(() => {
    setOriginalFile(null);
    setOriginalBuffer(null);
    setProcessedBuffer(null);
    setMetadata(null);
    setState({
      isLoading: false,
      isProcessing: false,
      progress: 0,
      error: null,
    });
  }, []);

  return {
    state,
    originalFile,
    originalBuffer,
    processedBuffer,
    metadata,
    loadAudioFile,
    processAudio,
    reset,
    getBufferDuration,
  };
}
