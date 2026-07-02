import { describe, it, expect } from 'vitest';
import { detectAttackOffset } from './beatSamples';
import { NIGHTCORE } from '../constants';

const SAMPLE_RATE = 44100;

/** Minimal AudioBuffer stand-in: detectAttackOffset only reads these members. */
function fakeBuffer(channels: Float32Array[], sampleRate = SAMPLE_RATE): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    length: channels[0]?.length ?? 0,
    sampleRate,
    getChannelData: (ch: number) => channels[ch],
  } as unknown as AudioBuffer;
}

describe('detectAttackOffset', () => {
  it('returns the time of the transient when the sample leads with silence', () => {
    const leadFrames = Math.round(0.008 * SAMPLE_RATE); // 8 ms of pre-attack silence
    const data = new Float32Array(4096);
    for (let i = leadFrames; i < data.length; i++) data[i] = 1 - (i - leadFrames) / (data.length - leadFrames);
    // The attack (rise to half the peak) sits at the lead, so the offset ~ 8 ms.
    expect(detectAttackOffset(fakeBuffer([data]))).toBeCloseTo(leadFrames / SAMPLE_RATE, 3);
  });

  it('is ~0 when the transient is already at the buffer head', () => {
    const data = new Float32Array(4096);
    for (let i = 0; i < data.length; i++) data[i] = 1 - i / data.length;
    expect(detectAttackOffset(fakeBuffer([data]))).toBeCloseTo(0, 3);
  });

  it('never shifts further than the alignment cap', () => {
    // A ramp that only crosses the threshold late would exceed the cap; it must clamp.
    const data = new Float32Array(SAMPLE_RATE); // 1 s
    for (let i = 0; i < data.length; i++) data[i] = i / data.length; // slow rise
    expect(detectAttackOffset(fakeBuffer([data]))).toBeLessThanOrEqual(NIGHTCORE.MAX_ALIGN_SECONDS);
  });

  it('returns 0 for a silent buffer', () => {
    expect(detectAttackOffset(fakeBuffer([new Float32Array(2048)]))).toBe(0);
  });

  it('aligns a bass-heavy kick by its attack, not its later sub peak', () => {
    // A sharp click followed by a sub swell peaking ~15 ms in - a kick's anatomy. The
    // grid sits on the song's own kick attacks, so the click (not the sub body) must
    // land on the beat: peak-aligning would flam our click ahead of the music's.
    const peakFrames = Math.round(0.015 * SAMPLE_RATE);
    const data = new Float32Array(4096);
    data[0] = 0.6; // the click
    for (let i = 1; i < data.length; i++) {
      data[i] = i <= 2 * peakFrames ? 0.5 * (1 - Math.cos((Math.PI * i) / peakFrames)) : 0;
    }
    expect(detectAttackOffset(fakeBuffer([data]))).toBeLessThan(0.002);
  });

  it('keeps a bright sample on its transient even when it swells louder later', () => {
    // 8 kHz tone: quiet click at the head, a louder swell only after 12 ms. The peak is
    // late, but a bright sound is placed by its onset - so the offset stays ~0.
    const swell = Math.round(0.012 * SAMPLE_RATE);
    const data = new Float32Array(4096);
    for (let i = 0; i < data.length; i++) {
      const amp = i < swell ? 0.6 : 1;
      data[i] = Math.sin((2 * Math.PI * 8000 * i) / SAMPLE_RATE) * amp;
    }
    expect(detectAttackOffset(fakeBuffer([data]))).toBeLessThan(0.002);
  });
});
