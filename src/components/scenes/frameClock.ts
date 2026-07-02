// Shared frame-loop timing for the canvas instruments (waveInstrument,
// SpectrumMeter, SceneAurora).

/**
 * Minimum ms between idle repaints (~30fps). When no audio is driving an
 * instrument, a full display-rate loop buys nothing visible, so the idle
 * paths skip frames younger than this and let the compositor rest.
 */
export const IDLE_FRAME_MS = 33;

/**
 * Real frame delta in seconds, clamped so a background-tab stall can't
 * teleport the physics (max 50ms) and a duplicate timestamp can't zero it
 * (min 1ms). Pass `lastNow < 0` on the first frame to get a 1/60 fallback.
 * Integrating over this keeps motion speed identical at 60, 120 or 144Hz.
 */
export function frameDeltaSeconds(now: number, lastNow: number): number {
  return lastNow < 0 ? 1 / 60 : Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
}
