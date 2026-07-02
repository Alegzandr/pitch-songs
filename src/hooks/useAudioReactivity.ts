import { useEffect, useRef } from 'react';
import { AUDIO_REACTIVITY } from '../constants';
import type { LoudnessProfile } from '../utils/audioLoudness';
import { prefersReducedMotion } from '../components/scenes/motion';

interface UseAudioReactivityOptions {
  /** Returns the live playback analyser, or null while stopped. */
  getAnalyser: () => AnalyserNode | null;
  /**
   * Returns the active track's loudness profile (peak + gated RMS), or null while
   * stopped. The engine calibrates intensity to it so quiet/dynamic and hot/
   * compressed masters drive comparable visuals. Optional - omitted (or returning
   * null) keeps the legacy fixed scaling.
   */
  getLoudness?: () => LoudnessProfile | null;
  isPlaying: boolean;
  /** Element to receive the CSS variables. Defaults to the document root. */
  target?: HTMLElement | null;
}

/**
 * The "breathe with the music" engine - Reverie's signature.
 *
 * Each frame it reads the live playback analyser and publishes a handful of
 * normalised audio-energy values as CSS custom properties on the target element
 * (the document root by default), where stylesheets consume them to swell bloom,
 * pulse borders and brighten the environment:
 *
 *   --audio-level   overall loudness  (time-domain RMS, fast attack / slow release)
 *   --audio-bass    low-band energy   (kick/bass weight)
 *   --audio-treble  high-band energy  (air/transients)
 *   --audio-pulse   onset flash       (spikes on a kick, decays fast)
 *
 * This is subconscious emotional feedback, not a gamer RGB visualiser. It only
 * runs while a track plays, freezes flat under prefers-reduced-motion, and eases
 * every value back to rest when playback stops so nothing ever snaps. The
 * smoothed state lives in a ref so easing stays continuous across play/pause.
 */
export function useAudioReactivity({ getAnalyser, getLoudness, isPlaying, target }: UseAudioReactivityOptions) {
  // Smoothed, published energies - kept in a ref so a play/pause toggle eases
  // from the current value instead of jumping back to zero on effect re-run.
  const energy = useRef({ level: 0, bass: 0, mid: 0, treble: 0, pulse: 0, bassBaseline: 0 });

  useEffect(() => {
    const root = target ?? document.documentElement;
    const reduceMotion = prefersReducedMotion();

    const e = energy.current;

    // Cache the last published (3-decimal-rounded) values so flat/steady frames
    // skip the five style writes entirely - each setProperty forces a style recalc.
    const last = { level: -1, bass: -1, mid: -1, treble: -1, pulse: -1 };

    const publish = () => {
      const rl = Math.round(e.level * 1000);
      const rb = Math.round(e.bass * 1000);
      const rm = Math.round(e.mid * 1000);
      const rt = Math.round(e.treble * 1000);
      const rp = Math.round(e.pulse * 1000);
      if (rl === last.level && rb === last.bass && rm === last.mid && rt === last.treble && rp === last.pulse) {
        return;
      }
      last.level = rl;
      last.bass = rb;
      last.mid = rm;
      last.treble = rt;
      last.pulse = rp;
      root.style.setProperty('--audio-level', e.level.toFixed(3));
      root.style.setProperty('--audio-bass', e.bass.toFixed(3));
      root.style.setProperty('--audio-mid', e.mid.toFixed(3));
      root.style.setProperty('--audio-treble', e.treble.toFixed(3));
      root.style.setProperty('--audio-pulse', e.pulse.toFixed(3));
    };

    const clear = () => {
      // Reset the cache so the next play republishes (removed props fall back to the
      // :root defaults of 0).
      last.level = last.bass = last.mid = last.treble = last.pulse = -1;
      root.style.removeProperty('--audio-level');
      root.style.removeProperty('--audio-bass');
      root.style.removeProperty('--audio-mid');
      root.style.removeProperty('--audio-treble');
      root.style.removeProperty('--audio-pulse');
    };

    // Honour reduced-motion absolutely: a flat, silent interface.
    if (reduceMotion) {
      clear();
      return;
    }

    let raf = 0;
    let freq: Uint8Array<ArrayBuffer> | null = null;
    let time: Uint8Array<ArrayBuffer> | null = null;

    const frame = () => {
      const analyser = typeof getAnalyser === 'function' ? getAnalyser() : null;

      if (analyser && isPlaying) {
        const bins = analyser.frequencyBinCount;
        if (!freq || freq.length !== bins) freq = new Uint8Array(new ArrayBuffer(bins));
        if (!time || time.length !== analyser.fftSize) {
          time = new Uint8Array(new ArrayBuffer(analyser.fftSize));
        }
        analyser.getByteFrequencyData(freq);
        analyser.getByteTimeDomainData(time);

        // Calibrate to the track's loudness so quiet/dynamic and hot/compressed
        // masters read evenly: aim the gated integrated RMS at TARGET_RMS (lifting
        // quiet tracks, pulling loud ones back, clamped to [MIN_GAIN, MAX_GAIN]),
        // then cap the result by available headroom (1 / peak) so a track that's
        // quiet on average but spikes loud isn't boosted until its transients slam.
        // norm = 1 when no loudness source is wired, preserving the fixed scaling.
        const loud = typeof getLoudness === 'function' ? getLoudness() : null;
        let norm = 1;
        if (loud) {
          const loudnessGain = Math.min(
            AUDIO_REACTIVITY.MAX_GAIN,
            Math.max(
              AUDIO_REACTIVITY.MIN_GAIN,
              AUDIO_REACTIVITY.TARGET_RMS / Math.max(loud.rms, AUDIO_REACTIVITY.RMS_FLOOR),
            ),
          );
          norm = Math.min(loudnessGain, 1 / Math.max(loud.peak, AUDIO_REACTIVITY.PEAK_FLOOR));
        }

        // Loudness - RMS of the time-domain signal (128 = silence midpoint).
        let sumSq = 0;
        for (let i = 0; i < time.length; i++) {
          const v = (time[i] - 128) / 128;
          sumSq += v * v;
        }
        // Global intensity trim: pushes the calibrated targets a touch further into
        // their range for more energy/amplitude, still clamped to 1 so it stays juste.
        const gain = norm * AUDIO_REACTIVITY.INTENSITY;

        // RMS rarely exceeds ~0.45 on real music; lift it into a usable 0..1.
        const targetLevel = Math.min(1, Math.sqrt(sumSq / time.length) * 2.2 * gain);

        // Three distinct bands so different surfaces can react to different parts
        // of the music (not everything strobing on the kick): bass = low ~12%,
        // mid = ~12–55%, treble = top ~40%.
        const bassEnd = Math.max(1, Math.floor(bins * 0.12));
        let bSum = 0;
        for (let i = 0; i < bassEnd; i++) bSum += freq[i];
        const targetBass = Math.min(1, (bSum / bassEnd / 255) * gain);

        const midStart = bassEnd;
        const midEnd = Math.max(midStart + 1, Math.floor(bins * 0.55));
        let mSum = 0;
        for (let i = midStart; i < midEnd; i++) mSum += freq[i];
        const targetMid = Math.min(1, (mSum / (midEnd - midStart) / 255) * gain);

        const trebleStart = Math.floor(bins * 0.6);
        let tSum = 0;
        for (let i = trebleStart; i < bins; i++) tSum += freq[i];
        const targetTreble = Math.min(1, (tSum / (bins - trebleStart) / 255) * gain);

        // Fast attack, slower release - reads musical, not jittery.
        e.level += (targetLevel - e.level) * (targetLevel > e.level ? 0.5 : 0.12);
        e.bass += (targetBass - e.bass) * (targetBass > e.bass ? 0.5 : 0.15);
        e.mid += (targetMid - e.mid) * (targetMid > e.mid ? 0.45 : 0.18);
        e.treble += (targetTreble - e.treble) * 0.3;

        // Onset - bass punching above its own slow baseline fires a flash.
        e.bassBaseline += (targetBass - e.bassBaseline) * 0.08;
        if (targetBass > e.bassBaseline * 1.35 + 0.06) {
          e.pulse = Math.min(1, Math.max(e.pulse, (targetBass - e.bassBaseline) * 3));
        }
        e.pulse *= 0.86;
        if (e.pulse < 0.005) e.pulse = 0;

        publish();
        raf = requestAnimationFrame(frame);
      } else {
        // Stopped (or analyser gone) - ease everything down, then settle + clear.
        e.level *= 0.85;
        e.bass *= 0.85;
        e.mid *= 0.85;
        e.treble *= 0.85;
        e.pulse *= 0.8;
        if (e.level + e.bass + e.mid + e.treble + e.pulse > 0.01) {
          publish();
          raf = requestAnimationFrame(frame);
        } else {
          e.level = e.bass = e.mid = e.treble = e.pulse = 0;
          clear();
        }
      }
    };

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [getAnalyser, getLoudness, isPlaying, target]);
}
