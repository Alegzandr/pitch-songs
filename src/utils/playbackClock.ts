/**
 * Tiny external store for the playhead position.
 *
 * The playback tick advances ~60×/s; routing it through React state re-renders
 * the whole App tree every frame. Instead the engine publishes the time here,
 * and only the few widgets that actually display it subscribe - either through
 * useSyncExternalStore at their own granularity (the clock texts re-render once
 * per second) or with a plain subscription that writes to the DOM/canvas
 * directly (progress fill, waveform playhead).
 */
export interface PlaybackClock {
  /** Current playhead position, in seconds. */
  get(): number;
  /** Subscribe to position changes; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
}

export interface MutablePlaybackClock extends PlaybackClock {
  set(time: number): void;
}

export function createPlaybackClock(initial = 0): MutablePlaybackClock {
  let time = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => time,
    set(next: number) {
      if (next === time) return;
      time = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
