import { useCallback, useEffect, useRef, useState } from 'react';
import { AUDIO_PROCESSING, ERROR_MESSAGES } from '../constants';
import type { AudioProcessingOptions } from '../utils/audioProcessor';
import { applyEffectOptions, applyEqGains, NEUTRAL_OPTIONS } from '../utils/effectGraph';
import { buildPlaybackGraph, teardownPlaybackGraph, type PlaybackGraph } from '../utils/playbackGraph';
import { readStoredBool, readStoredNumber, writeStored } from '../utils/storage';
import { EQ_FLAT_GAINS } from '../contexts/eqPresets';
import { getBufferLoudness, type LoudnessProfile } from '../utils/audioLoudness';
import { createPlaybackClock, type MutablePlaybackClock } from '../utils/playbackClock';

export interface PlaybackState {
  isPlaying: boolean;
  duration: number;
  volume: number;
  repeat: boolean;
  error: string | null;
}

interface UseAudioPlaybackParams {
  getAudioContext: () => AudioContext;
  getBufferDuration: (buffer: AudioBuffer | null) => number;
  getFallbackBuffer: () => AudioBuffer | null;
  onError?: (message: string | null) => void;
}

interface AttachOptions {
  resetPosition?: boolean;
}

/**
 * Manages playback through a live effect graph. Effects are applied in real time:
 * `setEffects` ramps the running graph (DAW-style), and any change is also picked up
 * the next time playback starts. Playback position is tracked in source-buffer time,
 * advancing at the current playback rate so the playhead stays accurate when the
 * speed changes mid-play.
 *
 * The position is deliberately NOT React state: the 60fps tick publishes into
 * `playbackClock` (a tiny external store) so only the widgets that display the
 * time subscribe to it - React re-renders happen solely on discrete transitions
 * (play, stop, seek, ended).
 */
export function useAudioPlayback({
  getAudioContext,
  getBufferDuration,
  getFallbackBuffer,
  onError,
}: UseAudioPlaybackParams) {
  const [state, setState] = useState<PlaybackState>(() => ({
    isPlaying: false,
    duration: 0,
    volume: readStoredNumber(AUDIO_PROCESSING.VOLUME_STORAGE_KEY, AUDIO_PROCESSING.DEFAULT_VOLUME),
    repeat: readStoredBool(AUDIO_PROCESSING.REPEAT_STORAGE_KEY),
    error: null,
  }));

  // Playhead position store - written by the tick, read by subscribers. Lazy
  // useState (never set) keeps one instance for the hook's whole life.
  const [clock] = useState<MutablePlaybackClock>(() => createPlaybackClock());

  // Mirror of state.volume so playAudio doesn't need to re-create on every
  // volume change (a slider drag would otherwise cascade through handlePlay,
  // handleTogglePlay and the spacebar keydown subscription per input event).
  const volumeRef = useRef(state.volume);

  const graphRef = useRef<PlaybackGraph | null>(null);
  const playbackRafRef = useRef<number | null>(null);
  const startOffsetRef = useRef<number>(0);
  const playStartTimeRef = useRef<number>(0);
  const activeBufferRef = useRef<AudioBuffer | null>(null);
  const playbackSessionRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const optionsRef = useRef<AudioProcessingOptions>(NEUTRAL_OPTIONS);
  // Listening EQ gains (dB per band). A separate channel from the export options
  // above, so the EQ shapes playback only and never reaches the offline renderer.
  const eqGainsRef = useRef<number[]>(EQ_FLAT_GAINS);
  const rateRef = useRef<number>(1);
  const repeatRef = useRef<boolean>(state.repeat);
  // Latest playAudio, captured for the onended loop restart without making the
  // callback depend on itself.
  const playAudioRef = useRef<((buffer?: AudioBuffer, startTime?: number) => void) | null>(null);

  const setError = useCallback((message: string | null) => {
    setState((prev) => ({ ...prev, error: message }));
    if (onError) {
      onError(message);
    }
  }, [onError]);

  const captureProgress = useCallback(() => {
    const audioContext = getAudioContext();
    if (!activeBufferRef.current) return startOffsetRef.current;
    const elapsed = Math.max(0, audioContext.currentTime - playStartTimeRef.current);
    const totalDuration = getBufferDuration(activeBufferRef.current);
    return Math.min(startOffsetRef.current + elapsed * rateRef.current, totalDuration);
  }, [getAudioContext, getBufferDuration]);

  const teardownGraph = useCallback(() => {
    teardownPlaybackGraph(graphRef.current);
    graphRef.current = null;
  }, []);

  const cancelProgressTick = useCallback(() => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    playbackSessionRef.current += 1;
    const nextTime = captureProgress();

    teardownGraph();
    cancelProgressTick();

    activeBufferRef.current = null;
    startOffsetRef.current = nextTime;
    isPlayingRef.current = false;
    clock.set(nextTime);
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, [cancelProgressTick, captureProgress, clock, teardownGraph]);

  const attachBuffer = useCallback((buffer: AudioBuffer | null, options: AttachOptions = {}) => {
    activeBufferRef.current = buffer;
    const duration = getBufferDuration(buffer);
    const resetPosition = options.resetPosition ?? false;
    const clampedStart = resetPosition ? 0 : Math.min(startOffsetRef.current, duration);
    startOffsetRef.current = clampedStart;
    clock.set(resetPosition ? 0 : Math.min(clock.get(), duration));
    setState((prev) => ({ ...prev, duration }));
  }, [clock, getBufferDuration]);

  const playAudio = useCallback((buffer?: AudioBuffer, startTime?: number) => {
    const audioContext = getAudioContext();
    const bufferToPlay = buffer || activeBufferRef.current || getFallbackBuffer();

    if (!bufferToPlay) {
      setError(ERROR_MESSAGES.NO_AUDIO_TO_PLAY);
      return;
    }

    setError(null);

    // Browsers suspend the AudioContext until a user gesture; playback is one.
    if (audioContext.state === 'suspended' && typeof audioContext.resume === 'function') {
      audioContext.resume();
    }

    playbackSessionRef.current += 1;
    const sessionId = playbackSessionRef.current;

    teardownGraph();
    cancelProgressTick();

    const totalDuration = getBufferDuration(bufferToPlay);
    // Use provided startTime or current offset (don't depend on state.playbackTime)
    const startAt = Math.max(0, Math.min(startTime ?? startOffsetRef.current, totalDuration));
    startOffsetRef.current = startAt;
    activeBufferRef.current = bufferToPlay;
    rateRef.current = optionsRef.current.speedMultiplier || 1;

    const graph = buildPlaybackGraph(audioContext, bufferToPlay, {
      volume: volumeRef.current,
      options: optionsRef.current,
      eqGains: eqGainsRef.current,
    });
    graphRef.current = graph;

    // Publishes into the clock store, NOT React state - a 60fps setState here
    // would re-render the whole App tree every frame.
    const tick = () => {
      if (playbackSessionRef.current !== sessionId) return;
      if (!activeBufferRef.current || !graphRef.current) return;
      const elapsed = audioContext.currentTime - playStartTimeRef.current;
      const nextTime = Math.min(startOffsetRef.current + elapsed * rateRef.current, totalDuration);
      clock.set(nextTime);
      if (nextTime < totalDuration) {
        playbackRafRef.current = requestAnimationFrame(tick);
      }
    };

    graph.source.onended = () => {
      if (playbackSessionRef.current !== sessionId) return;
      // Repeat: when the track reaches its end, restart from the top with the same
      // buffer and live effects instead of stopping. Manual stops/seeks null this
      // handler before the source ends, so the loop only fires on a natural finish.
      if (repeatRef.current && activeBufferRef.current) {
        startOffsetRef.current = 0;
        playAudioRef.current?.(activeBufferRef.current, 0);
        return;
      }
      isPlayingRef.current = false;
      clock.set(totalDuration);
      setState((prev) => ({ ...prev, isPlaying: false }));
      teardownGraph();
      cancelProgressTick();
    };

    playStartTimeRef.current = audioContext.currentTime;
    isPlayingRef.current = true;
    clock.set(startAt);
    setState((prev) => ({
      ...prev,
      isPlaying: true,
      duration: totalDuration,
    }));
    graph.source.start(0, startAt);
    playbackRafRef.current = requestAnimationFrame(tick);
  }, [cancelProgressTick, clock, getAudioContext, getBufferDuration, getFallbackBuffer, setError, teardownGraph]);

  // Keep the ref pointing at the latest playAudio so onended can loop without the
  // callback referencing itself (and without an impossible self-dependency).
  useEffect(() => {
    playAudioRef.current = playAudio;
  }, [playAudio]);

  const stopAudio = useCallback(() => {
    stopPlayback();
  }, [stopPlayback]);

  const toggleRepeat = useCallback(() => {
    setState((prev) => {
      const next = !prev.repeat;
      repeatRef.current = next;
      writeStored(AUDIO_PROCESSING.REPEAT_STORAGE_KEY, next);
      return { ...prev, repeat: next };
    });
  }, []);

  const updateVolume = useCallback((newVolume: number) => {
    volumeRef.current = newVolume;
    setState((prev) => ({ ...prev, volume: newVolume }));
    writeStored(AUDIO_PROCESSING.VOLUME_STORAGE_KEY, newVolume);
    if (graphRef.current) {
      graphRef.current.gain.gain.value = newVolume;
    }
  }, []);

  const seekTo = useCallback((time: number, bufferOverride?: AudioBuffer | null) => {
    const buffer = bufferOverride || activeBufferRef.current || getFallbackBuffer();
    const totalDuration = getBufferDuration(buffer);
    if (!buffer || totalDuration <= 0) return;

    const clamped = Math.max(0, Math.min(time, totalDuration));
    activeBufferRef.current = buffer;
    startOffsetRef.current = clamped;
    clock.set(clamped);
    setState((prev) => ({ ...prev, duration: totalDuration }));

    if (isPlayingRef.current) {
      playAudio(buffer, clamped);
    }
  }, [clock, getBufferDuration, getFallbackBuffer, playAudio]);

  /**
   * Update effects in real time. While playing, parameters ramp on the live graph;
   * a speed change rebases the position clock so the playhead stays accurate. When
   * paused, the new settings simply apply the next time playback starts.
   */
  const setEffects = useCallback((options: AudioProcessingOptions) => {
    optionsRef.current = options;
    const graph = graphRef.current;
    if (!graph || !isPlayingRef.current) return;

    const audioContext = getAudioContext();
    applyEffectOptions(graph.chain, options, audioContext, true);

    const nextRate = options.speedMultiplier || 1;
    if (nextRate !== rateRef.current) {
      // Rebase the position clock before switching rate so elapsed time keeps mapping
      // correctly, then glide the source to the new rate.
      startOffsetRef.current = captureProgress();
      playStartTimeRef.current = audioContext.currentTime;
      rateRef.current = nextRate;
      const param = graph.source.playbackRate;
      if (typeof param.setTargetAtTime === 'function') {
        param.setTargetAtTime(nextRate, audioContext.currentTime, 0.04);
      } else {
        param.value = nextRate;
      }
    }
  }, [captureProgress, getAudioContext]);

  /**
   * Update the listening EQ in real time. While playing, every band ramps on the
   * live graph; otherwise the gains apply the next time playback starts. Export is
   * unaffected - the EQ lives entirely on the playback graph.
   */
  const setEq = useCallback((gains: number[]) => {
    eqGainsRef.current = gains;
    const graph = graphRef.current;
    if (!graph || !isPlayingRef.current) return;
    applyEqGains(graph.chain, gains, getAudioContext(), true);
  }, [getAudioContext]);

  const resetPlayback = useCallback(() => {
    stopPlayback();
    startOffsetRef.current = 0;
    activeBufferRef.current = null;
    optionsRef.current = NEUTRAL_OPTIONS;
    rateRef.current = 1;
    clock.set(0);
    setState((prev) => ({
      ...prev,
      isPlaying: false,
      duration: 0,
      error: null,
    }));
  }, [clock, stopPlayback]);

  useEffect(() => {
    return () => {
      playbackSessionRef.current += 1;
      teardownGraph();
      cancelProgressTick();
      activeBufferRef.current = null;
      isPlayingRef.current = false;
    };
  }, [cancelProgressTick, teardownGraph]);

  // Live analyser node for visualisations; null while stopped.
  const getAnalyser = useCallback(() => graphRef.current?.analyser ?? null, []);

  // The active track's loudness profile (peak + gated integrated RMS), or null when
  // nothing is attached. Lets reactive visuals calibrate their intensity to each
  // song's loudness and headroom instead of fixed constants. Measured once per
  // buffer and cached.
  const getLoudness = useCallback((): LoudnessProfile | null => {
    const buffer = activeBufferRef.current;
    return buffer ? getBufferLoudness(buffer) : null;
  }, []);

  return {
    state,
    /** Playhead position store - subscribe/read without re-rendering per frame. */
    playbackClock: clock,
    playAudio,
    stopAudio,
    seekTo,
    updateVolume,
    toggleRepeat,
    setEffects,
    setEq,
    attachBuffer,
    resetPlayback,
    getAnalyser,
    getLoudness,
  };
}
