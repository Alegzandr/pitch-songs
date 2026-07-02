import { describe, it, expect } from 'vitest';
import { estimateTempo } from './tempo';
import { TEMPO_DETECTION } from '../constants';

const SAMPLE_RATE = 44100;

/**
 * Build a synthetic click track: a short decaying tone burst on every beat, so the
 * onset envelope has a clean spike per beat for the estimator to lock onto.
 */
function clickTrack(bpm: number, seconds: number, offsetSec = 0): Float32Array {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  const period = (60 / bpm) * SAMPLE_RATE; // samples per beat
  const burst = 1024;
  for (let t = offsetSec * SAMPLE_RATE; t < samples.length; t += period) {
    const start = Math.round(t);
    for (let i = 0; i < burst && start + i < samples.length; i++) {
      const env = 1 - i / burst; // linear decay
      samples[start + i] = Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) * env;
    }
  }
  return samples;
}

/**
 * A pattern with a quiet low kick on beats 1 & 3 and a LOUDER high snare on 2 & 4 -
 * the case that trips a full-band phase estimate into locking onto the backbeat.
 */
function kickSnareTrack(bpm: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  const beat = (60 / bpm) * SAMPLE_RATE; // samples per beat
  const addBurst = (start: number, len: number, freq: number, amp: number) => {
    for (let i = 0; i < len && start + i < samples.length; i++) {
      samples[start + i] += Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * amp * (1 - i / len);
    }
  };
  for (let k = 0; k * beat < samples.length; k++) {
    const start = Math.round(k * beat);
    if (k % 2 === 0) addBurst(start, 2048, 60, 0.5); // kick: low + quiet (beats 1 & 3)
    else addBurst(start, 1024, 5000, 1.0); // snare: high + loud (beats 2 & 4)
  }
  return samples;
}

/**
 * A backbeat groove that fools the raw autocorrelation into the 2-beat lag: beats
 * alternate loud kick / softer snare (so the envelope correlates best two beats
 * apart), with eighth-note hats carrying the subdivision energy that lets the
 * harmonic-comb re-ranking recognize the true beat rate.
 */
function backbeatGroove(bpm: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  const beat = (60 / bpm) * SAMPLE_RATE;
  const addBurst = (start: number, len: number, freq: number, amp: number) => {
    for (let i = 0; i < len && start + i < samples.length; i++) {
      samples[start + i] += Math.sin((2 * Math.PI * freq * i) / SAMPLE_RATE) * amp * (1 - i / len);
    }
  };
  for (let k = 0; k * beat < samples.length; k++) {
    const start = Math.round(k * beat);
    if (k % 2 === 0) addBurst(start, 2048, 60, 1.0);
    else addBurst(start, 1024, 4000, 0.55);
    addBurst(Math.round(start + beat / 2), 512, 8000, 0.35);
  }
  return samples;
}

/**
 * A burst on every beat with the downbeat (every `beatsPerBar`-th beat) accented, so
 * the beat-synchronous accent series has a clean period of `beatsPerBar` for the meter
 * detector to lock onto.
 */
function meterTrack(bpm: number, beatsPerBar: number, seconds: number): Float32Array {
  const samples = new Float32Array(Math.floor(SAMPLE_RATE * seconds));
  const beat = (60 / bpm) * SAMPLE_RATE;
  const burst = 1024;
  for (let k = 0; k * beat < samples.length; k++) {
    const start = Math.round(k * beat);
    const amp = k % beatsPerBar === 0 ? 1.0 : 0.4; // accent the downbeat
    for (let i = 0; i < burst && start + i < samples.length; i++) {
      samples[start + i] += Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) * (1 - i / burst) * amp;
    }
  }
  return samples;
}

describe('estimateTempo', () => {
  it('recovers a 120 BPM click track', () => {
    const { bpm } = estimateTempo(clickTrack(120, 8), SAMPLE_RATE);
    expect(bpm).toBeGreaterThan(117);
    expect(bpm).toBeLessThan(123);
  });

  it('recovers a 160 BPM click track without folding to an octave', () => {
    const { bpm } = estimateTempo(clickTrack(160, 8), SAMPLE_RATE);
    expect(bpm).toBeGreaterThan(156);
    expect(bpm).toBeLessThan(164);
  });

  it('recovers the downbeat phase (offset within the bar)', () => {
    const period = 60 / 120; // 0.5 s per beat
    // Circular distance: the phase is only meaningful modulo the beat period.
    const circDist = (a: number, b: number, p: number) => {
      const d = Math.abs((((a - b) % p) + p) % p);
      return Math.min(d, p - d);
    };

    // A track starting on the beat reads ~0 (mod the period).
    const onBeat = estimateTempo(clickTrack(120, 8, 0), SAMPLE_RATE);
    expect(circDist(onBeat.beatOffsetSec, 0, period)).toBeLessThan(0.03);

    // A track whose first onset sits 0.12 s in reads ~0.12 s.
    const shifted = estimateTempo(clickTrack(120, 8, 0.12), SAMPLE_RATE);
    expect(circDist(shifted.beatOffsetSec, 0.12, period)).toBeLessThan(0.03);
  });

  it('locks the downbeat to the kick, not the louder backbeat snare', () => {
    const twoBeats = 2 * (60 / 120); // 1.0 s (kick recurs every 2 beats)
    const circDist = (a: number, b: number, p: number) => {
      const d = Math.abs((((a - b) % p) + p) % p);
      return Math.min(d, p - d);
    };
    const { beatOffsetSec } = estimateTempo(kickSnareTrack(120, 8), SAMPLE_RATE);
    // Kicks sit at 0, 1, 2 s; the offset must align to them (dist ~0 mod 2 beats), not
    // to the snare half a beat away (which would read ~0.5 s).
    expect(circDist(beatOffsetSec, 0, twoBeats)).toBeLessThan(0.05);
  });

  it('recovers a fractional-lag tempo to sub-0.05 BPM (no integer-lag quantization)', () => {
    // 90 BPM sits between integer envelope lags (57.42 frames at 44.1 kHz / 512), the
    // case where the coarse autocorrelation alone is 1-3 BPM off. That error compounds
    // into a beat-sized grid drift within a minute of music, so precision here is what
    // keeps the Nightcore bed glued to a full-length track.
    const { bpm } = estimateTempo(clickTrack(90, 60), SAMPLE_RATE);
    expect(Math.abs(bpm - 90)).toBeLessThan(0.05);
  });

  it('keeps the beat grid within 40 ms of the last click of a minute-long track', () => {
    const trueBpm = 87.3; // deliberately awkward: nowhere near an integer lag
    const period = 60 / trueBpm;
    const { bpm, beatOffsetSec } = estimateTempo(clickTrack(trueBpm, 60), SAMPLE_RATE);
    const lastClick = Math.floor(59 / period) * period;
    // The estimated grid's beat nearest that click must still sit on it - this is the
    // audible "stays aligned to the end of the song" guarantee.
    const predicted = beatOffsetSec + Math.round(((lastClick - beatOffsetSec) * bpm) / 60) * (60 / bpm);
    expect(Math.abs(predicted - lastClick)).toBeLessThan(0.04);
  });

  it('recovers the beat (not its 2-beat lag) from a backbeat groove', () => {
    // On this pattern the weighted autocorrelation alone picks the 2-beat lag and ships
    // a half-tempo grid (measured on real material: a 150 BPM track shipped as 75, with
    // every other clap landing off the snare). The harmonic-comb re-ranking of the
    // pick's metrical relatives must recover the true rate - and with it, 4/4.
    const { bpm, beatsPerBar } = estimateTempo(backbeatGroove(150.5, 60), SAMPLE_RATE);
    expect(Math.abs(bpm - 150.5)).toBeLessThan(0.05);
    expect(beatsPerBar).toBe(4);
  });

  it('falls back to the default tempo on silence', () => {
    const silence = new Float32Array(SAMPLE_RATE * 2);
    const estimate = estimateTempo(silence, SAMPLE_RATE);
    expect(estimate.bpm).toBe(TEMPO_DETECTION.DEFAULT_BPM);
    expect(estimate.beatOffsetSec).toBe(0);
  });

  it('falls back on a too-short clip', () => {
    const tiny = new Float32Array(100);
    expect(estimateTempo(tiny, SAMPLE_RATE).bpm).toBe(TEMPO_DETECTION.DEFAULT_BPM);
  });
});

describe('meter detection', () => {
  it('reads a downbeat-every-4 groove as 4/4', () => {
    expect(estimateTempo(meterTrack(120, 4, 12), SAMPLE_RATE).beatsPerBar).toBe(4);
  });

  it('reads a downbeat-every-3 groove as 3/4 (waltz)', () => {
    expect(estimateTempo(meterTrack(120, 3, 12), SAMPLE_RATE).beatsPerBar).toBe(3);
  });

  it('defaults to 4/4 when the meter is undecidable (silence)', () => {
    expect(estimateTempo(new Float32Array(SAMPLE_RATE * 2), SAMPLE_RATE).beatsPerBar).toBe(4);
  });
});
