import { useCallback, useMemo, useRef, useState } from 'react';
import { audioProcessor } from '../utils/audioProcessor';
import type { AudioProcessingOptions } from '../utils/audioProcessor';
import { NEUTRAL_OPTIONS } from '../utils/effectGraph';
import { useAudioFile } from './useAudioFile';
import { useAudioPlayback } from './useAudioPlayback';
import { useAudioExport } from './useAudioExport';

export interface ProcessingState {
  isLoading: boolean;
  isProcessing: boolean;
  isExporting: boolean;
  isPlaying: boolean;
  progress: number;
  error: string | null;
}

/**
 * Orchestrates audio file management, real-time playback, and export.
 *
 * Effects are applied live: `setEffects` ramps the playing graph and is remembered
 * for the next play and for export. Export renders the current settings offline on
 * demand, so there is no separate "apply/bake" step in the UI.
 */
export function useAudioProcessor() {
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef<AudioProcessingOptions>(NEUTRAL_OPTIONS);
  const renderedRef = useRef<AudioBuffer | null>(null);

  const {
    state: fileState,
    originalFile,
    originalBuffer,
    processedBuffer,
    metadata,
    loadAudioFile: loadFile,
    processAudio: processFile,
    reset: resetFile,
    getBufferDuration,
  } = useAudioFile();

  const getPlaybackBuffer = useCallback(
    () => processedBuffer || originalBuffer || audioProcessor.getAudioBuffer(),
    [processedBuffer, originalBuffer],
  );

  // Stable accessor: a fresh inline arrow here would change identity every render,
  // which cascades through useAudioPlayback's memoised callbacks (captureProgress →
  // setEffects) into App's handleEffectChange. EffectControls lists that onChange in
  // a useEffect dependency array, so an unstable identity re-runs the effect every
  // render - an infinite re-render loop in the editor (only visible once a dialog
  // injects a synchronous setState into the storm: "Maximum update depth exceeded").
  const getAudioContext = useCallback(() => audioProcessor.getAudioContext(), []);

  const {
    state: playbackState,
    playbackClock,
    playAudio,
    stopAudio,
    seekTo,
    updateVolume,
    toggleRepeat,
    setEffects: setPlaybackEffects,
    setEq,
    attachBuffer,
    resetPlayback,
    getAnalyser,
    getLoudness,
  } = useAudioPlayback({
    getAudioContext,
    getBufferDuration,
    getFallbackBuffer: getPlaybackBuffer,
    onError: setError,
  });

  const {
    state: exportState,
    exportProcessedAudio: runExport,
    resetExport,
  } = useAudioExport({
    getBuffer: () => renderedRef.current || processedBuffer || audioProcessor.getAudioBuffer(),
    originalFile,
    metadata,
    getBufferDuration,
    onError: setError,
  });

  const combinedError = useMemo(
    () => error ?? fileState.error ?? playbackState.error ?? exportState.error ?? null,
    [error, fileState.error, playbackState.error, exportState.error],
  );

  const loadAudioFile = useCallback(async (file: File) => {
    setError(null);
    stopAudio();
    renderedRef.current = null;
    const buffer = await loadFile(file);
    const nextBuffer = buffer || audioProcessor.getAudioBuffer();
    attachBuffer(nextBuffer, { resetPosition: true });
    return buffer;
  }, [attachBuffer, loadFile, stopAudio]);

  // Apply effects in real time and remember them for the next play and for export.
  const setEffects = useCallback((options: AudioProcessingOptions) => {
    optionsRef.current = options;
    renderedRef.current = null; // settings changed; any cached render is stale
    setPlaybackEffects(options);
  }, [setPlaybackEffects]);

  // Kept for the offline pipeline/tests; the UI no longer bakes a processed track.
  const processAudio = useCallback(async (options: AudioProcessingOptions) => {
    setError(null);
    stopAudio();
    const buffer = await processFile(options);
    attachBuffer(buffer, { resetPosition: true });
    return buffer;
  }, [attachBuffer, processFile, stopAudio]);

  // Render the current effect settings offline, then export the result.
  const exportProcessedAudio = useCallback(async (arg?: string | { filename?: string; effectLabel?: string }) => {
    const source = audioProcessor.getAudioBuffer();
    if (source) {
      try {
        renderedRef.current = await audioProcessor.processAudio(optionsRef.current);
      } catch {
        renderedRef.current = source;
      }
    }
    // Free the full rendered buffer (can be tens of MB) once the encode settles;
    // `return await` keeps it captured for the whole encode, the next export
    // re-renders anyway. The error still propagates after the finally.
    try {
      return await runExport(arg);
    } finally {
      renderedRef.current = null;
    }
  }, [runExport]);

  const reset = useCallback(() => {
    stopAudio();
    resetFile();
    resetPlayback();
    resetExport();
    optionsRef.current = NEUTRAL_OPTIONS;
    renderedRef.current = null;
    setError(null);
  }, [resetExport, resetFile, resetPlayback, stopAudio]);

  return {
    state: {
      isLoading: fileState.isLoading,
      isProcessing: fileState.isProcessing,
      isExporting: exportState.isExporting,
      isPlaying: playbackState.isPlaying,
      progress: fileState.progress,
      error: combinedError,
    } as ProcessingState,
    originalFile,
    originalBuffer,
    processedBuffer,
    // Playhead position store - read/subscribe without per-frame re-renders.
    playbackClock,
    duration: playbackState.duration,
    volume: playbackState.volume,
    repeat: playbackState.repeat,
    metadata,
    loadAudioFile,
    processAudio,
    setEffects,
    // Listening EQ - playback-only, never baked into exports, so it bypasses the
    // optionsRef/render-cache plumbing that setEffects needs.
    setEq,
    playAudio,
    stopAudio,
    exportProcessedAudio,
    updateVolume,
    seekTo,
    toggleRepeat,
    reset,
    getAnalyser,
    getLoudness,
  };
}
