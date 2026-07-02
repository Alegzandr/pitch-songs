import { useRef } from 'react';

export interface UseScrubberOptions {
  /** Total clip duration in seconds; a falsy duration disables interaction. */
  duration: number;
  /** Commits a real seek (rebuilds the audio graph) - on press and on drag-end. */
  onSeek: (time: number) => void;
  /** Element whose bounding rect maps a pointer X to a 0..1 ratio (also receives pointer capture). */
  surfaceRef: React.RefObject<HTMLElement | null>;
  /** Current playhead time, read lazily for the ArrowLeft/ArrowRight ±5s seeks. */
  getTime: () => number;
  disabled?: boolean;
  /** Visual-only playhead update during a press/drag (no seek). */
  onDragVisual: (ratio: number) => void;
  /** Reset the visual playhead once the drag has committed. */
  onDragEnd: () => void;
  /** Extra per-press bookkeeping, right after the drag is armed. */
  onDragStart?: (event: React.PointerEvent<HTMLElement>) => void;
  /** Extra per-move bookkeeping while dragging (e.g. edge auto-scroll). */
  onDragMove?: (event: React.PointerEvent<HTMLElement>) => void;
}

/**
 * The shared pointer-scrub state machine behind the timeline surfaces
 * (waveform instrument + transport seekbar). While scrubbing we move the
 * playhead visually but defer the actual seek to drag-end, so dragging stops
 * rebuilding the whole audio graph on every pointermove - the host paints the
 * in-flight position through `onDragVisual` and resets it in `onDragEnd`.
 *
 * Hosts with extra drag behaviour (edge auto-scroll, pan) compose on top via
 * `onDragStart`/`onDragMove` and the exposed `ratioFromPointer` /
 * `updateDragRatio` primitives, or by wrapping the returned handlers.
 */
export function useScrubber({
  duration,
  onSeek,
  surfaceRef,
  getTime,
  disabled,
  onDragVisual,
  onDragEnd,
  onDragStart,
  onDragMove,
}: UseScrubberOptions) {
  const draggingRef = useRef(false);
  // `dragRatioRef` holds the in-flight position so drag-end can commit it once.
  const dragRatioRef = useRef(0);
  const lastSeekedRatioRef = useRef(0);

  const ratioFromPointer = (clientX: number) => {
    if (disabled || !duration) return null;
    const rect = surfaceRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
  };

  /** Move the visual playhead (and the pending commit position) - never seeks. */
  const updateDragRatio = (ratio: number) => {
    onDragVisual(ratio);
    dragRatioRef.current = ratio;
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
    const r = ratioFromPointer(event.clientX);
    if (r === null) return;
    draggingRef.current = true;
    onDragStart?.(event);
    try {
      surfaceRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // setPointerCapture is unavailable in some environments; dragging still works.
    }
    // Seek immediately on press so a plain click still jumps the playhead.
    updateDragRatio(r);
    lastSeekedRatioRef.current = r;
    onSeek(r * duration);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLElement>) => {
    if (!draggingRef.current) return;
    const r = ratioFromPointer(event.clientX);
    if (r === null) return;
    // Visual only - the real seek (and graph rebuild) is deferred to drag-end.
    updateDragRatio(r);
    onDragMove?.(event);
  };

  const endDrag = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    // Commit the final position once; skip a redundant seek if the pointer never
    // moved off the press point (a plain click already seeked there).
    if (!disabled && duration && dragRatioRef.current !== lastSeekedRatioRef.current) {
      onSeek(dragRatioRef.current * duration);
    }
    onDragEnd();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (disabled || !duration) return;
    if (event.key === 'ArrowRight') onSeek(Math.min(duration, getTime() + 5));
    if (event.key === 'ArrowLeft') onSeek(Math.max(0, getTime() - 5));
  };

  return {
    draggingRef,
    dragRatioRef,
    ratioFromPointer,
    updateDragRatio,
    handlePointerDown,
    handlePointerMove,
    endDrag,
    handleKeyDown,
  };
}
