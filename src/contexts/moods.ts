import { Sun, Moon, Waves, Star, Sparkles, Sunrise } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Mood registry. `light` and `dark` are the quiet "workspace" faces (the calm
 * app shell); the immersive moods turn the interface into a translucent,
 * curved heads-up display floating over a living ambient scene you can lose
 * yourself in while the track plays.
 *
 * Each mood drives three things on <html>: `data-mood="<id>"` (selects the
 * colour-token block in index.css), the `.dark` class (kept so every existing
 * `dark:` utility and `.dark` rule still applies - immersive moods are
 * dark-based), and the `.immersive` class (switches the chrome to the HUD skin
 * and mounts the ambient scene).
 */
export type MoodId = 'light' | 'dark' | 'tidal' | 'nocturne' | 'aurora' | 'horizon';
export type MoodKind = 'workspace' | 'immersive';
export type SceneId = 'daybreak' | 'dusk' | 'tidal' | 'nocturne' | 'aurora' | 'horizon';

export interface MoodDef {
  id: MoodId;
  /** i18n key under `settings.mood.<key>` for the label. */
  labelKey: string;
  icon: LucideIcon;
  /** Visual family - `light`/`dark` are the calm palettes, the rest are vibey
   *  atmospheres. The HUD chrome is on for every mood; kind is only a grouping
   *  hint. */
  kind: MoodKind;
  /** Which base the mood sits on - toggles the `.dark` root class. */
  base: 'light' | 'dark';
  /** Animated ambient scene to mount. Every mood has one (the interface is
   *  always the immersive HUD; a mood = palette + animated background). */
  scene: SceneId;
  /** CSS gradient for the settings gallery thumbnail. */
  preview: string;
}

export const MOODS: Record<MoodId, MoodDef> = {
  light: {
    id: 'light',
    labelKey: 'light',
    icon: Sun,
    kind: 'workspace',
    base: 'light',
    scene: 'daybreak',
    preview: 'linear-gradient(180deg, #bfe0ff 0%, #dbeeff 52%, #eaf3ff 74%, #fff6ef 100%)',
  },
  dark: {
    id: 'dark',
    labelKey: 'dark',
    icon: Moon,
    kind: 'workspace',
    base: 'dark',
    scene: 'dusk',
    preview: 'radial-gradient(120% 100% at 50% 14%, #1a1638 0%, #0d0a24 52%, #07061a 100%)',
  },
  tidal: {
    id: 'tidal',
    labelKey: 'tidal',
    icon: Waves,
    kind: 'immersive',
    base: 'dark',
    scene: 'tidal',
    preview: 'linear-gradient(180deg, #0a1230 0%, #123a55 52%, #1f7d8c 78%, #58e0e8 100%)',
  },
  nocturne: {
    id: 'nocturne',
    labelKey: 'nocturne',
    icon: Star,
    kind: 'immersive',
    base: 'dark',
    scene: 'nocturne',
    preview: 'radial-gradient(120% 100% at 70% 18%, #2a1b5e 0%, #130c30 48%, #060414 100%)',
  },
  aurora: {
    id: 'aurora',
    labelKey: 'aurora',
    icon: Sparkles,
    kind: 'immersive',
    base: 'dark',
    scene: 'aurora',
    preview: 'linear-gradient(150deg, #0b0a26 0%, #2c1a63 38%, #5a2f8c 62%, #1f8f93 100%)',
  },
  horizon: {
    id: 'horizon',
    labelKey: 'horizon',
    icon: Sunrise,
    kind: 'immersive',
    base: 'dark',
    scene: 'horizon',
    preview: 'linear-gradient(180deg, #1a1140 0%, #5b2a6e 42%, #c75b7a 72%, #ffb487 100%)',
  },
};

export const MOOD_ORDER: MoodId[] = ['light', 'dark', 'tidal', 'nocturne', 'aurora', 'horizon'];

/** The CSS class painting each scene's photo backdrop (background-image lives in
 *  index.css). `daybreak` has no photo - it is drawn with pure CSS layers. */
export const SCENE_PHOTO_CLASS: Record<SceneId, string | null> = {
  daybreak: null,
  dusk: 'scene-photo-dusk',
  tidal: 'scene-photo-tidal',
  nocturne: 'scene-photo-nocturne',
  aurora: 'scene-photo-nebula',
  horizon: 'scene-photo-horizon',
};

export const DEFAULT_MOOD: MoodId = 'aurora';

export function isMoodId(value: unknown): value is MoodId {
  return typeof value === 'string' && value in MOODS;
}
