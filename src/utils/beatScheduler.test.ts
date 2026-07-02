import { describe, it, expect } from 'vitest';
import { beatRoles, beatOnsetTimes } from './beatScheduler';

describe('beatRoles in 4/4', () => {
  it('places the kick on beats 1 and 3 of the bar', () => {
    expect(beatRoles(0, 4)).toContain('kick'); // beat 1
    expect(beatRoles(2, 4)).toContain('kick'); // beat 3
    expect(beatRoles(1, 4)).not.toContain('kick');
    expect(beatRoles(3, 4)).not.toContain('kick');
  });

  it('places the clap on beats 2 and 4 of the bar', () => {
    expect(beatRoles(1, 4)).toContain('clap'); // beat 2
    expect(beatRoles(3, 4)).toContain('clap'); // beat 4
    expect(beatRoles(0, 4)).not.toContain('clap');
    expect(beatRoles(2, 4)).not.toContain('clap');
  });

  it('never includes hats', () => {
    for (let i = 0; i < 16; i++) expect(beatRoles(i, 4) as string[]).not.toContain('hat');
  });

  it('fires the crash on the downbeat of every 4th bar', () => {
    expect(beatRoles(0, 4)).toContain('finish'); // bar 1, beat 1
    expect(beatRoles(16, 4)).toContain('finish'); // bar 5, beat 1
    expect(beatRoles(4, 4)).not.toContain('finish'); // bar 2, beat 1
    expect(beatRoles(8, 4)).not.toContain('finish');
  });

  it('fires kick + crash together on the first downbeat', () => {
    expect(beatRoles(0, 4).sort()).toEqual(['finish', 'kick']);
  });
});

describe('beatRoles in 3/4 (waltz)', () => {
  it('runs a boom-tap-tap: kick on 1, clap on 2 and 3', () => {
    expect(beatRoles(0, 3)).toContain('kick'); // beat 1
    expect(beatRoles(1, 3)).not.toContain('kick');
    expect(beatRoles(2, 3)).not.toContain('kick');
    expect(beatRoles(1, 3)).toContain('clap'); // beat 2
    expect(beatRoles(2, 3)).toContain('clap'); // beat 3
    expect(beatRoles(0, 3)).not.toContain('clap');
  });

  it('fires the crash on the downbeat of every 4th bar (12 beats)', () => {
    expect(beatRoles(0, 3)).toContain('finish');
    expect(beatRoles(12, 3)).toContain('finish'); // bar 5, beat 1
    expect(beatRoles(3, 3)).not.toContain('finish'); // bar 2, beat 1
    expect(beatRoles(6, 3)).not.toContain('finish');
  });
});

describe('beatOnsetTimes (speed-up accounting)', () => {
  it('spaces beats at the untouched tempo when speed is 1', () => {
    const times = beatOnsetTimes(120, 0, 1, 10); // 120 BPM → 0.5 s per beat
    expect(times[0]).toBeCloseTo(0);
    expect(times[1] - times[0]).toBeCloseTo(0.5);
  });

  it('tightens the grid in proportion to the speed multiplier', () => {
    const base = beatOnsetTimes(120, 0, 1, 10);
    const fast = beatOnsetTimes(120, 0, 2, 10); // effective 240 BPM → 0.25 s per beat
    expect(fast[1] - fast[0]).toBeCloseTo(0.25);
    // Doubling the speed halves the spacing: the beats follow the speed-up exactly.
    expect(fast[1] - fast[0]).toBeCloseTo((base[1] - base[0]) / 2);
  });

  it('scales the first-downbeat offset by the speed too', () => {
    const offsetSec = 0.3;
    const slow = beatOnsetTimes(120, offsetSec, 1, 10);
    const fast = beatOnsetTimes(120, offsetSec, 1.5, 10);
    expect(slow[0]).toBeCloseTo(0.3);
    expect(fast[0]).toBeCloseTo(0.3 / 1.5);
  });

  it('stops at the output duration and handles a degenerate tempo', () => {
    expect(beatOnsetTimes(120, 0, 1, 1).every((t) => t < 1)).toBe(true);
    expect(beatOnsetTimes(0, 0, 1, 10)).toEqual([]);
  });
});
