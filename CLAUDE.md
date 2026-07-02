# CLAUDE.md

Reverie is a free, 100% client-side online audio editor (React 19 + TypeScript + Vite + Tailwind v4). Users load a track, tweak effects live while it plays, and export in the original format. Product vision: PRODUCT.md. Visual system: DESIGN.md.

## Commands

```bash
npm run dev            # Vite dev server (http://localhost:5173)
npm run build          # tsc -b && vite build
npm run lint           # eslint .
npx vitest run         # test suite, single pass (npm test starts watch mode)
npx vitest run <path>  # one file/folder
```

## Architecture

Two audio engines that must stay sonically identical:

- `src/utils/effectGraph.ts` - persistent live Web Audio graph. Effect changes ramp nodes in real time (~40 ms), no "apply" step. Convolver inputs attach/detach on demand so silent effects cost nothing.
- `src/utils/audioProcessor.ts` - offline render (`OfflineAudioContext`) used only at export time.
- Shared between them: `src/utils/dsp.ts` (gain/cutoff curves with measured coefficients - don't retune casually) and `src/utils/impulse.ts` (cached noise-decay impulse responses).

Hook composition (`src/hooks/`): `useAudioProcessor` orchestrates `useAudioFile` (load + header metadata) + `useAudioPlayback` (live graph, position clock, volume/repeat persistence) + `useAudioExport` (filenames, strategy dispatch). App.tsx consumes only `useAudioProcessor`.

Export (`src/utils/exportStrategies.ts`): strategy per source format, matched output (MP3→MP3, FLAC→FLAC via libFLAC WASM, WebM/OGG/M4A via MediaRecorder), with fallbacks (FLAC→WAV, MediaRecorder→MP3). Encoders are `import()`ed on demand - keep them off the initial bundle.

Moods (`src/contexts/moods.ts` + `MoodContext.tsx`): 6 moods (light, dark, tidal, nocturne, aurora, horizon) = palette + ambient scene. Applied as `data-mood` + `.dark`/`.immersive` on `<html>`; tokens live in `src/index.css` (OKLCH). "Mood" is the product term - never reintroduce "theme".

Audio reactivity (`src/hooks/useAudioReactivity.ts`): a live analyser publishes `--audio-level/-bass/-mid/-treble/-pulse` CSS vars; scenes/HUD read them (canvas code reads them per frame). Intensity is calibrated per track via `src/utils/audioLoudness.ts`.

## Rules

- Every UI string goes through i18next; add keys to all 10 locales in `src/i18n/locales/` (a consistency test enforces parity). Exception: export filename labels (`EFFECT_EXPORT_LABELS`) stay English.
- No magic numbers: tunables live in `src/constants.ts` (or a module-local named constant when single-use).
- The listening EQ (`EqContext`) shapes playback only - it must never reach the offline renderer or exports.
- UI sections never move position (no positional drift); honor `prefers-reduced-motion` in any animated/reactive code.
- Callback identity matters: accessors passed into the hook chain must be stable (`useCallback`) - an unstable one cascades into an infinite render loop (see the note in `useAudioProcessor`).
- Desktop-only: viewports < 1024px are gated (`DesktopOnlyGate`); don't add mobile layouts.
- Tests are colocated (`*.test.tsx?`); keep coverage when refactoring. `src/setupTests.ts` provides Web Audio/canvas stubs.
- Comments explain "why", never "what"; keep the measured-coefficient docs in dsp.ts/effectGraph.ts intact.
