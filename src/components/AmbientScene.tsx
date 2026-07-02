import { memo, useEffect, useReducer, useRef } from 'react';
import { useMood } from '../contexts/MoodContext';
import { SCENE_PHOTO_CLASS } from '../contexts/moods';
import type { SceneId } from '../contexts/moods';
import { animatedBackdropAllowed } from './scenes/motion';
import { SceneAurora } from './scenes/SceneAurora';

/**
 * Full-viewport ambient backdrop for the active mood: a cosmic photo base
 * (`.scene-photo`) brought alive by pointer parallax, autonomous drift and
 * colour haze. Composites on the GPU; never touches the Web Audio graph; freezes
 * on a still frame under `prefers-reduced-motion`.
 *
 * Key constraint: parallax drives `transform` (via --px/--py) while drift drives
 * `background-position`, so the two animations never fight over one property.
 * `daybreak` has no photo, so it keeps pure CSS layers and gets no parallax/haze.
 */

/** The image URL each photo scene loads, matched to the `url()` in index.css.
 *  Built from BASE_URL so it warms the SAME cache entry the CSS requests (Vite
 *  rewrites the stylesheet's root-absolute public paths to include the base). */
const PHOTO_SRC: Record<SceneId, string | null> = {
  daybreak: null,
  dusk: `${import.meta.env.BASE_URL}backgrounds/void-bloom.webp`,
  tidal: `${import.meta.env.BASE_URL}backgrounds/cosmic-wave.webp`,
  nocturne: `${import.meta.env.BASE_URL}backgrounds/midnight-pulse.webp`,
  aurora: `${import.meta.env.BASE_URL}backgrounds/nebula-drift.webp`,
  horizon: `${import.meta.env.BASE_URL}backgrounds/lunar-haze.webp`,
};

/** Module-scoped memory of which backdrops have finished decoding, so a mood we
 *  return to (or one warmed by the preloader) shows instantly - no re-fade, and
 *  crucially no flash of the near-black scene floor while the backdrop decodes. */
const decoded = new Set<string>();

/** Kick off (and decode) a backdrop fetch once; resolves into `decoded`. The
 *  browser dedupes against the stylesheet's own request, so this only ever warms
 *  the cache, it never double-downloads. */
function warm(src: string) {
  if (decoded.has(src)) return;
  const img = new Image();
  img.src = src;
  const done = () => decoded.add(src);
  // decode() resolves once the bitmap is paint-ready; fall back to load/error so
  // a decode failure (or a browser without Image.decode) can't strand a mood.
  if (img.decode) img.decode().then(done, done);
  else {
    img.onload = done;
    img.onerror = done;
  }
}

const DAYBREAK_LAYERS = (
  <>
    <div className="day-sun" />
    <div className="day-cloud-a" />
    <div className="day-cloud-b" />
    <div className="day-cloud-c" />
  </>
);

export const AmbientScene = memo(function AmbientScene() {
  const { def, showBackdrop } = useMood();
  const sceneRef = useRef<HTMLDivElement>(null);
  const scene = def.scene;
  const isPhoto = scene !== 'daybreak';
  // The photo backdrop is the only layer the user can switch off; the haze,
  // aurora, veil, particles and meteors stay on (the "rest" of the scene).
  const showPhoto = isPhoto && showBackdrop;
  const photoClass = SCENE_PHOTO_CLASS[scene];
  const photoSrc = PHOTO_SRC[scene];

  // The photo fades in only once its bitmap is decoded; until then we'd otherwise
  // be staring at the near-black scene floor (the "black blink"). `decoded` is a
  // module cache, so a warm backdrop is visible on the very first paint and
  // `ready` is derived straight from it - no synced state to fall out of date.
  const [, onDecoded] = useReducer((n: number) => n + 1, 0);
  const ready = !photoSrc || decoded.has(photoSrc);

  // Warm ALL backdrops once, up front, so switching mood never lands on an
  // undecoded image. This is load-bearing, not a nicety: the mood-dive's
  // `warp-scene-in` has no `forwards`, so when it ends the incoming photo falls
  // back to `.scene-photo`'s opacity:0 default until `is-ready` - i.e. a black
  // flash after every switch unless the backdrop is already decoded. Must stay
  // eager (do NOT defer to requestIdleCallback). Fire-and-forget; cache does the rest.
  useEffect(() => {
    for (const src of Object.values(PHOTO_SRC)) if (src) warm(src);
  }, []);

  // Kick off the current photo's decode when it isn't cached yet, then force a
  // re-render so `ready` flips. Reruns on every scene change; the cancelled flag
  // drops a late decode if the mood moved on.
  useEffect(() => {
    if (!photoSrc || decoded.has(photoSrc)) return;
    let cancelled = false;
    const img = new Image();
    img.src = photoSrc;
    const reveal = () => {
      decoded.add(photoSrc);
      if (!cancelled) onDecoded();
    };
    if (img.decode) img.decode().then(reveal, reveal);
    else {
      img.onload = reveal;
      img.onerror = reveal;
    }
    return () => {
      cancelled = true;
    };
  }, [photoSrc]);

  // Pointer parallax: publish a normalised cursor offset (--px/--py, ~-1..1) that
  // each layer translates by its own depth factor. rAF-throttled; CSS smooths it.
  useEffect(() => {
    const el = sceneRef.current;
    if (!el || !animatedBackdropAllowed()) return;
    let raf = 0;
    let px = 0;
    let py = 0;
    // Skip writing a CSS var when the rounded value hasn't changed: a style write
    // forces a recalc, and tiny sub-millipixel cursor jitter shouldn't pay for it.
    let lastPx = NaN;
    let lastPy = NaN;
    const apply = () => {
      raf = 0;
      const rx = Math.round(px * 1000);
      const ry = Math.round(py * 1000);
      if (rx !== lastPx) {
        el.style.setProperty('--px', (rx / 1000).toString());
        lastPx = rx;
      }
      if (ry !== lastPy) {
        el.style.setProperty('--py', (ry / 1000).toString());
        lastPy = ry;
      }
    };
    const onMove = (e: PointerEvent) => {
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // `scene` keys both the layer markup and the `.scene-<id>` CSS.
  return (
    <div ref={sceneRef} className={`scene scene-${scene}`} aria-hidden="true">
      {showPhoto ? (
        <div className={`scene-photo ${photoClass ?? ''}${ready ? ' is-ready' : ''}`} />
      ) : isPhoto ? null : (
        DAYBREAK_LAYERS
      )}
      {/* Living aurora veils - the audio-reactive shader light over the photo.
          Gates itself (reduced motion, touch, software GPU, no WebGL2). */}
      {isPhoto && <SceneAurora />}
      {isPhoto && (
        <>
          <div className="scene-haze scene-haze-a" />
          <div className="scene-haze scene-haze-b" />
        </>
      )}
      <div className="scene-veil" />
      {/* Bloom that swells with the music; lives behind the glass, not over the UI. */}
      <div className="scene-breath" />
      {/* Drifting dust whose density rises with treble. */}
      <div className="scene-particles" />
      {isPhoto && (
        <div className="scene-meteors">
          <span className="meteor" />
          <span className="meteor" />
          <span className="meteor" />
          <span className="meteor" />
        </div>
      )}
      <div className="hud-scanlines" />
      <div className="hud-vignette" />
    </div>
  );
});
