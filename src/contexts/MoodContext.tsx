/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { MOODS, DEFAULT_MOOD, isMoodId } from './moods';
import type { MoodId, MoodDef } from './moods';

const STORAGE_KEY = 'mood';
const RECENTS_KEY = 'mood-recents';
/** Whether the ambient scene paints its photo backdrop. Stored separately so it's
 *  a single preference across every mood; missing/anything-but-'false' means on. */
const BACKDROP_KEY = 'mood-backdrop';
/** How many moods the rail surfaces as "recently used". */
const MAX_RECENTS = 5;
/** How long `.mood-shifting` stays on <html> to ease the palette across a switch.
 *  Slightly longer than the 600ms colour transition in index.css, so the tween
 *  finishes before the class is pulled (yanking it mid-tween would snap the
 *  remaining distance). */
const MOOD_SHIFT_MS = 700;

interface MoodContextType {
  mood: MoodId;
  def: MoodDef;
  setMood: (id: MoodId) => void;
  /** Most-recently-applied moods, newest first, current mood always at index 0. */
  recentMoods: MoodId[];
  /** Whether the scene shows its photo backdrop (the rest of the scene stays). */
  showBackdrop: boolean;
  toggleBackdrop: () => void;
}

const MoodContext = createContext<MoodContextType | undefined>(undefined);

function readInitialMood(): MoodId {
  const saved = localStorage.getItem(STORAGE_KEY);
  return isMoodId(saved) ? saved : DEFAULT_MOOD;
}

function readRecents(): MoodId[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]');
    if (Array.isArray(raw)) return raw.filter(isMoodId);
  } catch {
    // Corrupt/missing list - start fresh.
  }
  return [];
}

function readInitialBackdrop(): boolean {
  // Default on; only an explicit 'false' turns the photo off.
  return localStorage.getItem(BACKDROP_KEY) !== 'false';
}

export function MoodProvider({ children }: { children: ReactNode }) {
  const [mood, setMoodState] = useState<MoodId>(readInitialMood);
  const [showBackdrop, setShowBackdrop] = useState<boolean>(readInitialBackdrop);
  const [recentMoods, setRecentMoods] = useState<MoodId[]>(() => {
    const current = readInitialMood();
    // Pin the active mood to the front so the rail always opens on the mood
    // you're actually hearing.
    return [current, ...readRecents().filter((id) => id !== current)].slice(0, MAX_RECENTS);
  });
  // Tracks the palette already painted, so we cross-fade only on a real change
  // (not the first apply). Null until the first effect run.
  const paintedMood = useRef<MoodId | null>(null);
  const shiftTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const def = MOODS[mood];
    localStorage.setItem(STORAGE_KEY, def.id);

    const root = document.documentElement;
    // Ease every palette-driven colour across the swap (text, accent fills,
    // borders, icons) - see `.mood-shifting` in index.css. Skip the very first
    // apply: there's no previous palette to cross-fade from. The scene/bloom dive
    // is orchestrated separately by <MoodTransition>.
    if (paintedMood.current !== null && paintedMood.current !== mood) {
      root.classList.add('mood-shifting');
      window.clearTimeout(shiftTimer.current);
      shiftTimer.current = window.setTimeout(
        () => root.classList.remove('mood-shifting'),
        MOOD_SHIFT_MS
      );
    }
    paintedMood.current = mood;

    root.setAttribute('data-mood', def.id);
    // Dark-based moods keep the `.dark` class so every existing `dark:` utility
    // and `.dark` rule keeps working without a rewrite.
    root.classList.toggle('dark', def.base === 'dark');
    // The futuristic HUD is the one interface, present for every mood; a mood
    // only swaps the palette + the animated background. So `.immersive` is
    // always on (it gates the holographic chrome + ambient scene).
    root.classList.add('immersive');
  }, [mood]);

  // Drop the pending cross-fade cleanup if we unmount mid-switch.
  useEffect(() => () => window.clearTimeout(shiftTimer.current), []);

  useEffect(() => {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(recentMoods));
  }, [recentMoods]);

  const setMood = useCallback((id: MoodId) => {
    if (!isMoodId(id)) return;
    setMoodState(id);
    setRecentMoods((prev) => [id, ...prev.filter((t) => t !== id)].slice(0, MAX_RECENTS));
  }, []);

  const toggleBackdrop = useCallback(() => {
    setShowBackdrop((prev) => {
      const next = !prev;
      localStorage.setItem(BACKDROP_KEY, String(next));
      return next;
    });
  }, []);

  // Stable value object so memoised consumers (AmbientScene, MoodRail, …) can bail
  // out when the provider re-renders for an unrelated reason.
  const value = useMemo(
    () => ({ mood, def: MOODS[mood], setMood, recentMoods, showBackdrop, toggleBackdrop }),
    [mood, recentMoods, setMood, showBackdrop, toggleBackdrop],
  );

  return (
    <MoodContext.Provider value={value}>
      {children}
    </MoodContext.Provider>
  );
}

export function useMood() {
  const context = useContext(MoodContext);
  if (!context) {
    throw new Error('useMood must be used within MoodProvider');
  }
  return context;
}
