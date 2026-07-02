import { memo, useEffect, useRef, useState } from 'react';
import { useMood } from '../contexts/MoodContext';
import { MOODS, SCENE_PHOTO_CLASS } from '../contexts/moods';
import type { SceneId } from '../contexts/moods';
import { animatedBackdropAllowed } from './scenes/motion';

/**
 * Mood switch = plunging into a new environment. The cockpit glass stays put
 * (the compositor); the world we're leaving dissolves as we break through it,
 * while the new environment rises out of a slight zoom and settles into focus
 * around us - a centred luminous swell (in the new mood's own colour) cresting
 * over the cockpit at the threshold. Spectacular but composed: no lateral slide,
 * no sci-fi chrome, one slow expo curve. All GPU-composited (transform / opacity
 * / filter) and gated by `animatedBackdropAllowed()`, so under
 * `prefers-reduced-motion` (or on touch) nothing here runs and the calm 300ms
 * body cross-fade stands in.
 */

/** Total dive length; keep in sync with the dive keyframes in index.css. */
const DIVE_MS = 1020;

interface Dive {
  /** Bumps each switch so the overlay remounts and replays its keyframes. */
  id: number;
  /** The world we're leaving (drives the outgoing photo layer). */
  outgoing: SceneId;
}

export const MoodTransition = memo(function MoodTransition() {
  const { mood, showBackdrop } = useMood();
  const prevMood = useRef(mood);
  const counter = useRef(0);
  const [dive, setDive] = useState<Dive | null>(null);

  useEffect(() => {
    const from = prevMood.current;
    prevMood.current = mood;
    if (from === mood) return;
    // Reduced motion / touch: skip the dive, let the body cross-fade carry it.
    if (!animatedBackdropAllowed()) return;

    counter.current += 1;
    const id = counter.current;
    setDive({ id, outgoing: MOODS[from].scene });

    // Drives the incoming scene's rise-into-focus and the gentle HUD swell (CSS).
    const root = document.documentElement;
    root.classList.add('mood-warp');
    const offClass = window.setTimeout(() => root.classList.remove('mood-warp'), DIVE_MS);
    const offDive = window.setTimeout(
      () => setDive((d) => (d && d.id === id ? null : d)),
      DIVE_MS + 60
    );
    return () => {
      window.clearTimeout(offClass);
      window.clearTimeout(offDive);
      root.classList.remove('mood-warp');
    };
  }, [mood]);

  if (!dive) return null;
  // What we're leaving behind: the outgoing photo when the backdrop is on, or the
  // daybreak wash for the (photo-less) light mood. With the backdrop off on a dark
  // mood there's nothing to dissolve but the near-black floor the live scene
  // already shows underneath - so we skip the outgoing world entirely. (Falling
  // back to `.warp-world-flat` here would flash its light wash: a white blink.)
  const outPhoto = showBackdrop ? SCENE_PHOTO_CLASS[dive.outgoing] : null;
  const outLight = dive.outgoing === 'daybreak';

  return (
    <>
      {/* The world we're leaving - a full-bleed copy of the outgoing backdrop that
          scales up, blurs and dissolves as we break through it, revealing the new
          environment rising into focus underneath. Isolated so the panels'
          backdrop-filter samples one flat layer while it animates (no flash). */}
      {(outPhoto || outLight) && (
        <div key={`world-${dive.id}`} className="warp-world" aria-hidden="true">
          {outPhoto ? (
            <div className={`scene-photo ${outPhoto}`} />
          ) : (
            <div className="warp-world-flat" />
          )}
        </div>
      )}

      {/* The luminous swell - a centred bloom in the NEW mood's colour (its tokens
          are already live on :root), cresting over the whole cockpit at the
          threshold and clearing. The spectacle, kept classy: no rings, no streaks. */}
      <div key={`bloom-${dive.id}`} className="warp-bloom" aria-hidden="true" />
    </>
  );
});
