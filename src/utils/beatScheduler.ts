import { NIGHTCORE } from '../constants';
import { loadBeatSamples, type BeatRole, type BeatSampleSet } from './beatSamples';

/** Local fallback tempo, kept out of the import cycle with the tempo module. */
const NIGHTCORE_DEFAULT_BPM = 120;
/** Meter assumed until tempo detection reports one (mirrors TEMPO_DETECTION default). */
const DEFAULT_BEATS_PER_BAR = 4;
/** Hard cap on beats scheduled per tick - a runaway-loop backstop. */
const MAX_BEATS_PER_TICK = 64;
/** Hard cap on beats baked into one offline render - a runaway-loop backstop. */
const MAX_BEATS_PER_RENDER = 100_000;

/**
 * Nightcore beat bed - a 4/4 percussion grid layered under the Speed Up effect and
 * locked to the track's detected tempo.
 *
 * Timing uses lookahead scheduling ("A Tale of Two Clocks"): a coarse JS timer wakes
 * every TICK_MS and hands every upcoming beat to the sample-accurate Web Audio clock
 * via `start(when)`, so hits land on time regardless of setInterval jitter.
 *
 * The grid is expressed in *song time* (seconds into the untouched track) and mapped
 * to audio-clock time through an anchor that mirrors the playback hook's position
 * clock: song(t) = songOffset + (t - contextStartTime) * playbackRate. A live speed
 * change just re-anchors, so the beats stay glued to the music after the speed-up.
 */

/**
 * Output-timeline time (seconds) of every beat, for a render sped up by `speed`.
 * The grid is defined in the untouched track's time (period 60/bpm, first downbeat
 * at beatOffsetSec) and mapped to the sped-up output by dividing by `speed` - so the
 * effective tempo is bpm × speed. Pure, so the "beats follow the speed-up" invariant
 * is unit-tested directly. Shared by the offline export; the live scheduler applies
 * the identical /rate mapping against the audio clock.
 */
export function beatOnsetTimes(
  bpm: number,
  beatOffsetSec: number,
  speed: number,
  outputDuration: number,
): number[] {
  if (bpm <= 0 || speed <= 0) return [];
  const period = 60 / bpm; // song seconds per beat
  const times: number[] = [];
  for (let index = 0; ; index++) {
    const when = (beatOffsetSec + index * period) / speed;
    if (when >= outputDuration) break;
    times.push(when);
    if (times.length > MAX_BEATS_PER_RENDER) break; // backstop
  }
  return times;
}

/**
 * Which samples a given beat fires, for the detected meter. Pure so it can be
 * unit-tested in isolation.
 */
export function beatRoles(beatIndex: number, beatsPerBar: 3 | 4): BeatRole[] {
  const pattern = beatsPerBar === 3 ? NIGHTCORE.PATTERNS[3] : NIGHTCORE.PATTERNS[4];
  const beatInBar = ((beatIndex % beatsPerBar) + beatsPerBar) % beatsPerBar;
  const roles: BeatRole[] = [];
  if ((pattern.KICK_BEATS as readonly number[]).includes(beatInBar)) roles.push('kick');
  if ((pattern.CLAP_BEATS as readonly number[]).includes(beatInBar)) roles.push('clap');
  // Crash/finish on the downbeat of every FINISH_EVERY_BARS-th bar boundary.
  if (beatIndex % (beatsPerBar * NIGHTCORE.FINISH_EVERY_BARS) === 0) roles.push('finish');
  return roles;
}

export interface BeatAnchor {
  /** ctx.currentTime captured when playback started (or last re-anchored). */
  contextStartTime: number;
  /** Song position (untouched-track seconds) at contextStartTime. */
  songOffset: number;
  /** Current playback rate (speed multiplier). */
  playbackRate: number;
  /** Track length in song seconds; beats past it are never scheduled. */
  songDuration: number;
}

export class BeatScheduler {
  private ctx: BaseAudioContext;
  /** User-facing beat level (independent of the track's master volume). */
  readonly output: GainNode;
  private roleGains: Record<BeatRole, GainNode>;

  private samples: BeatSampleSet | null = null;
  private loading = false;

  private bpm = NIGHTCORE_DEFAULT_BPM;
  private beatOffsetSec = 0;
  private beatsPerBar: 3 | 4 = DEFAULT_BEATS_PER_BAR;
  private enableBeats = false;
  private anchor: BeatAnchor | null = null;
  private nextIndex = 0;

  private running = false;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(ctx: BaseAudioContext, volume: number) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    this.output.gain.value = volume;
    this.roleGains = {
      kick: this.makeRoleGain(NIGHTCORE.ROLE_GAINS.kick),
      clap: this.makeRoleGain(NIGHTCORE.ROLE_GAINS.clap),
      finish: this.makeRoleGain(NIGHTCORE.ROLE_GAINS.finish),
    };
  }

  private makeRoleGain(value: number): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.value = value;
    gain.connect(this.output);
    return gain;
  }

  /** Per-track tempo, downbeat phase, and meter from the tempo estimator. */
  setTempo(bpm: number, beatOffsetSec: number, beatsPerBar: 3 | 4): void {
    this.bpm = bpm > 0 ? bpm : NIGHTCORE_DEFAULT_BPM;
    this.beatOffsetSec = Math.max(0, beatOffsetSec);
    this.beatsPerBar = beatsPerBar;
  }

  /** Turn the bed on/off without restarting playback. */
  setPattern(enableBeats: boolean): void {
    const wasEnabled = this.enableBeats;
    this.enableBeats = enableBeats;
    // Re-enabling after a pause: jump the grid cursor to the live playhead so the
    // timer doesn't waste a tick fast-forwarding through beats it slept through.
    if (enableBeats && !wasEnabled && this.anchor) {
      this.nextIndex = this.indexAtOrAfter(this.currentSongTime());
    }
    this.ensureTimer();
  }

  /** Ramp the independent beat volume (no zipper noise). */
  setVolume(volume: number, ramp: boolean): void {
    const param = this.output.gain;
    if (ramp && typeof param.setTargetAtTime === 'function') {
      param.setTargetAtTime(volume, this.ctx.currentTime, 0.04);
    } else {
      param.value = volume;
    }
  }

  /**
   * (Re)anchor the grid to the audio clock. Called at playback start and whenever the
   * playback hook rebases on a speed change. The cursor only moves forward, so an
   * in-flight beat already handed to the clock is never re-fired.
   */
  setAnchor(anchor: BeatAnchor): void {
    this.anchor = anchor;
    this.nextIndex = Math.max(this.nextIndex, this.indexAtOrAfter(anchor.songOffset));
  }

  start(): void {
    this.running = true;
    this.ensureTimer();
  }

  stop(): void {
    this.running = false;
    this.ensureTimer();
  }

  /** Tear down: stop the timer and detach nodes. Cached samples are kept for reuse. */
  dispose(): void {
    this.stop();
    for (const role of Object.keys(this.roleGains) as BeatRole[]) {
      try {
        this.roleGains[role].disconnect();
      } catch {
        // already detached
      }
    }
    try {
      this.output.disconnect();
    } catch {
      // already detached
    }
  }

  private get period(): number {
    return 60 / this.bpm; // song seconds per beat
  }

  /** First beat index whose time is at/after a given song time. */
  private indexAtOrAfter(songTime: number): number {
    const raw = (songTime - this.beatOffsetSec) / this.period;
    return Math.max(0, Math.ceil(raw - 1e-6));
  }

  private currentSongTime(): number {
    if (!this.anchor) return 0;
    const { contextStartTime, songOffset, playbackRate } = this.anchor;
    return songOffset + (this.ctx.currentTime - contextStartTime) * playbackRate;
  }

  private ctxTimeForSong(songTime: number): number {
    const { contextStartTime, songOffset, playbackRate } = this.anchor!;
    return contextStartTime + (songTime - songOffset) / playbackRate;
  }

  private ensureTimer(): void {
    const shouldRun = this.running && this.enableBeats;
    if (shouldRun && !this.samples) {
      this.loadIfNeeded();
      return;
    }
    if (shouldRun && this.timer === null) {
      this.timer = setInterval(() => this.tick(), NIGHTCORE.TICK_MS);
      this.tick();
    } else if (!shouldRun && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private loadIfNeeded(): void {
    if (this.samples || this.loading) return;
    this.loading = true;
    loadBeatSamples(this.ctx)
      .then((set) => {
        this.samples = set;
        this.loading = false;
        this.ensureTimer();
      })
      .catch(() => {
        // Beats unavailable (fetch/decode failed): stay silent, never break playback.
        this.loading = false;
      });
  }

  private tick(): void {
    if (!this.running || !this.enableBeats || !this.samples || !this.anchor) return;

    const now = this.ctx.currentTime;
    const horizon = now + NIGHTCORE.SCHEDULE_AHEAD_SECONDS;

    // Schedule every beat whose audio-clock time falls before the horizon. Beats
    // already in the past (e.g. after a re-enable) advance the cursor without firing.
    for (let guard = 0; guard < MAX_BEATS_PER_TICK; guard++) {
      const songTime = this.beatOffsetSec + this.nextIndex * this.period;
      if (this.anchor.songDuration > 0 && songTime > this.anchor.songDuration) return;
      const when = this.ctxTimeForSong(songTime);
      if (when >= horizon) return;

      if (when >= now) {
        for (const role of beatRoles(this.nextIndex, this.beatsPerBar)) {
          this.playRole(role, when);
        }
      }
      this.nextIndex++;
    }
  }

  private playRole(role: BeatRole, when: number): void {
    if (!this.samples) return;
    const sample = this.samples[role];
    try {
      const src = this.ctx.createBufferSource();
      src.buffer = sample.buffer;
      src.connect(this.roleGains[role]);
      // Start early by the sample's attack so the hit lands on `when`, clamped so an
      // imminent beat can't schedule in the past.
      src.start(Math.max(this.ctx.currentTime, when - sample.attackOffsetSec));
    } catch {
      // A start() in the past (or an exhausted node) must never break the timer.
    }
  }
}
