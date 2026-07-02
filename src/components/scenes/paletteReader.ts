// Shared plumbing for the mood-aware canvas instruments (waveInstrument,
// SpectrumMeter, SceneAurora).

/**
 * getComputedStyle is a synchronous style flush, so canvas instruments cache
 * their palette and re-read it only when the mood could have changed. This owns
 * that gate: `ensure()` calls `read()` on first use, on a `data-mood` change,
 * and on every frame while the palette cross-fades (`.mood-shifting`).
 */
export function createMoodPaletteCache(read: () => void): { ensure: () => void } {
  let mood: string | undefined;
  let hasRead = false;
  return {
    ensure() {
      const root = document.documentElement;
      if (!hasRead || root.dataset.mood !== mood || root.classList.contains('mood-shifting')) {
        mood = root.dataset.mood;
        hasRead = true;
        read();
      }
    },
  };
}

/** Calibrated audio energy (0..1) published as inline CSS vars by useAudioReactivity. */
export function readEnergyVar(name: string): number {
  const value = document.documentElement.style.getPropertyValue(name);
  if (!value) return 0;
  const parsed = parseFloat(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}
