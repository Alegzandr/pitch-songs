# Reverie 🎵

**Reverie is a free online audio editor that turns your favorite tracks into dreamy remixes, right in your browser.**

Speed a song up, slow it down with reverb, spin it into immersive 8D, or boost the bass, then hear every change live as it plays and download the result in the same format you started with. No account, no upload, no install. Your files never leave your device.

**🌐 Try it now:** [alegzandr.github.io/reverie](https://alegzandr.github.io/reverie/)

> Reverie is built for a wide screen, use it on a laptop or desktop for the full experience.

---

## What you can do

### Reshape the sound
- **Speed Up** — high-energy sped-up versions (1.1x to 2.0x).
- **Slow + Reverb** — atmospheric, slowed-down remixes with adjustable reverb.
- **8D Audio** — immersive spatial sound that rotates around your headphones, with adjustable speed.
- **Bass Boost** — deeper low end in three strengths (Light, Normal, Strong).

Everything is **live**: press play, move any control, and the sound changes instantly. There is no "Apply" or "Process" step, you just listen and tune until it feels right.

### Make it yours
- **🪐 Moods** — six atmospheres, each a color palette plus an animated background: two calm workspaces (Light, Dark) and four immersive scenes (Tidal, Nocturne, Aurora, Horizon). Switch in one tap; your choice is remembered.
- **💓 Breathe with the music** — the whole interface reacts to what's playing: the background blooms, the frames pulse, and the play button glows on the beat.
- **📊 See your track** — a live waveform doubles as the seek bar and previews the effect you're applying, alongside a compact spectrum meter.
- **🌍 Ten languages** — English, French, Spanish, German, Portuguese, Russian, Chinese, Japanese, Korean, Hindi.
- **♿ Accessible** — full keyboard navigation, screen-reader support, and a calm static fallback if you prefer reduced motion.

### Keep your quality (and your privacy)
- **Smart export** — Reverie saves in the format you loaded whenever possible: MP3→MP3, WAV→WAV, AIFF→AIFF, FLAC→FLAC, WebM→WebM, OGG→OGG, M4A→M4A.
- **100% private** — all processing happens in your browser. Nothing is uploaded, tracked, or stored on a server.
- **Install it** — add Reverie to your desktop as an app (PWA) and it works offline.

## How to use it

1. **Load a track** — drag and drop, or click to browse. Supports MP3, WAV, AIFF, FLAC, OGG/Opus, WebM, AAC/M4A, and more.
2. **Pick an effect** — Speed Up, Slow + Reverb, 8D Audio, or Bass Boost.
3. **Press play and tune** — every slider reshapes the sound in real time.
4. **Set a mood** (optional) — choose a background from the mood rail.
5. **Export** — download your remix, matched to the original format and quality.

---

## For developers

Reverie is a 100% client-side app built with **React 19 + TypeScript + Vite 7 + Tailwind CSS v4**. All audio runs on the **Web Audio API**, with lazy-loaded encoders (lamejs for MP3, libFLAC WASM for FLAC, MediaRecorder for WebM/OGG/M4A).

```bash
npm install
npm run dev            # dev server at http://localhost:5173
npm run build          # tsc -b && vite build → dist/
npm run lint           # eslint
npx vitest run         # test suite (single pass)
```

Requires Node.js 20+.

### Architecture in brief

Two audio engines that must stay sonically identical:

- **`src/utils/effectGraph.ts`** — the persistent live Web Audio graph. Effect changes ramp nodes in real time (~40 ms), no bake step.
- **`src/utils/audioProcessor.ts`** — the offline render (`OfflineAudioContext`) used only at export time.

Exports are dispatched per source format via a Strategy pattern (`src/utils/exportStrategies.ts`), with fallbacks (FLAC→WAV, MediaRecorder→MP3). Moods live in `src/contexts/moods.ts`; every UI string goes through i18next across all 10 locales in `src/i18n/locales/`.

Deeper docs: [`CLAUDE.md`](CLAUDE.md) (architecture + rules), [`PRODUCT.md`](PRODUCT.md) (product vision), [`DESIGN.md`](DESIGN.md) (visual system).

### Contributing

Fork, branch, and open a PR. Keep tests colocated (`*.test.tsx?`) and passing, run `npm run lint`, and use conventional commit messages. Deployment to GitHub Pages is automated via GitHub Actions on every push to `main` (lint → typecheck → test → build → deploy).

## License

MIT. Free for personal and commercial use.

## Acknowledgments

Built with [React](https://react.dev/) and the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API). MP3 encoding by [lamejs](https://github.com/zhuker/lamejs), icons by [Lucide](https://lucide.dev/).

Found a bug or have an idea? [Open an issue](https://github.com/Alegzandr/reverie/issues).

---

Reverie, crafted for late-night listening 🎧
