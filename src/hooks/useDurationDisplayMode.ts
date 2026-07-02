import { useCallback, useSyncExternalStore } from 'react';
import { readStoredBool, writeStored } from '../utils/storage';

/**
 * Per-key clock-display preference: whether the trailing timecode shows the total
 * duration or the time remaining. Each toggle (transport footer, waveform header)
 * owns an independent value keyed by its storage key, so flipping one leaves the
 * other untouched, and each choice survives a reload. Backed by a tiny map of
 * module-level external stores - no provider to wire.
 */
interface Store {
  value: boolean;
  listeners: Set<() => void>;
}

const stores = new Map<string, Store>();

function getStore(storageKey: string): Store {
  let store = stores.get(storageKey);
  if (!store) {
    store = { value: readStoredBool(storageKey), listeners: new Set() };
    stores.set(storageKey, store);
  }
  return store;
}

export function toggleDurationDisplay(storageKey: string) {
  const store = getStore(storageKey);
  store.value = !store.value;
  writeStored(storageKey, store.value);
  store.listeners.forEach((listener) => listener());
}

/** Test helper: drop all cached stores so preferences reload from storage. */
export function resetDurationDisplayStores() {
  stores.clear();
}

/** Subscribe to one toggle's "show remaining" preference. Re-renders on toggle. */
export function useDurationDisplayMode(storageKey: string) {
  const store = getStore(storageKey);
  const subscribe = useCallback(
    (listener: () => void) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    [store],
  );
  return useSyncExternalStore(subscribe, () => store.value);
}
