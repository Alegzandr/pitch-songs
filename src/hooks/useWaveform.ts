import { useEffect, useState } from 'react';
import { WAVEFORM } from '../constants';
import { getOrCreateWaveform } from '../utils/waveform';

interface UseWaveformParams {
  buffer?: AudioBuffer | null;
  bars?: number;
}

interface UseWaveformState {
  bars: number[];
  isComputing: boolean;
}

// Yield to the next tick so a heavy first computation never blocks the render
// that mounted the component.
const schedule = (fn: () => void) => {
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(fn);
    return null;
  }
  return setTimeout(fn, 0);
};

/**
 * Hook that returns cached waveform bars for an AudioBuffer
 */
export function useWaveform({ buffer, bars = WAVEFORM.BAR_COUNT }: UseWaveformParams): UseWaveformState {
  const [state, setState] = useState<UseWaveformState>(() => ({
    bars: new Array(Math.max(1, Math.floor(bars))).fill(0),
    isComputing: Boolean(buffer),
  }));

  useEffect(() => {
    const targetBars = Math.max(1, Math.floor(bars));
    let cancelled = false;

    const handle = schedule(() => {
      if (cancelled) return;
      const next = buffer ? getOrCreateWaveform(buffer, targetBars) : new Array(targetBars).fill(0);
      setState({ bars: next, isComputing: false });
    });

    return () => {
      cancelled = true;
      if (typeof handle === 'number') {
        clearTimeout(handle);
      }
    };
  }, [buffer, bars]);

  return state;
}
