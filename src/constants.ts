/**
 * Application-wide constants
 * Centralized configuration for magic numbers, formats, and settings
 */

// ============================================================================
// AUDIO PROCESSING CONSTANTS
// ============================================================================

export const AUDIO_PROCESSING = {
    /** Default audio volume (0.0 to 1.0) */
    DEFAULT_VOLUME: 0.7,

    /** Storage key for persisting volume preference */
    VOLUME_STORAGE_KEY: "reverie:volume",

    /** Storage key for persisting repeat preference */
    REPEAT_STORAGE_KEY: "reverie:repeat",

    /** Storage keys for the "show time remaining" clock preference, one per toggle so they stay independent */
    DURATION_DISPLAY_STORAGE_KEY_FOOTER: "reverie:show-remaining:footer",
    DURATION_DISPLAY_STORAGE_KEY_WAVEFORM: "reverie:show-remaining:waveform",

    /** Keyboard seek step (seconds) for the left/right arrows and the timeline focus seeks */
    SEEK_STEP_SECONDS: 5,

    /** Volume step (0-1) for the up/down arrows and the volume wheel */
    VOLUME_STEP: 0.05,

    /** Progress update interval in milliseconds */
    PROGRESS_UPDATE_INTERVAL_MS: 100,

    /** Maximum progress value before completion */
    PROGRESS_MAX_BEFORE_COMPLETE: 90,

    /** Delay after buffer ends before stopping MediaRecorder (ms) */
    MEDIA_RECORDER_STOP_DELAY_MS: 100,
} as const;

// ============================================================================
// REACTIVE VISUALS
// ============================================================================

export const AUDIO_REACTIVITY = {
    /**
     * Reactive-visual intensity is calibrated per track so quiet/dynamic and hot/
     * compressed masters drive comparable visuals. The primary reference is the
     * track's gated integrated loudness (RMS): the gain aims it at TARGET_RMS, lifting
     * quiet tracks and pulling loud ones back. TARGET_RMS ~ a typical pop master, so
     * ordinary tracks land near gain 1 (unchanged from the original fixed scaling).
     */
    TARGET_RMS: 0.12,
    /** Floor on a track's measured RMS so a near-silent track can't explode the gain. */
    RMS_FLOOR: 0.03,
    /** Bounds on the loudness gain: pull hot masters down, lift quiet ones, but never
     *  past these limits. */
    MIN_GAIN: 0.5,
    MAX_GAIN: 4,
    /**
     * Peak headroom floor (~ -12 dBFS). The loudness gain is additionally capped at
     * 1 / peak so a track that's quiet on average but has loud transients doesn't get
     * boosted until those transients slam - preserving the "max dB" headroom guard.
     */
    PEAK_FLOOR: 0.25,
    /**
     * Global intensity trim applied to the per-band targets *after* per-track
     * calibration, then re-clamped to [0,1]. Above 1 it pushes the reactive
     * visuals with a touch more energy and amplitude (swelling further into their
     * range) without changing the relative band balance or breaking the headroom
     * guard - values still saturate at 1, so it stays tasteful, never blown out.
     */
    INTENSITY: 1.25,
} as const;

// ============================================================================
// BITRATE CONSTANTS
// ============================================================================

export const BITRATE = {
    /** Default MP3 bitrate in kbps */
    DEFAULT_MP3_KBPS: 192,

    /** Minimum MP3 bitrate in kbps */
    MIN_MP3_KBPS: 96,

    /** Maximum MP3 bitrate in kbps */
    MAX_MP3_KBPS: 320,

    /** Default MediaRecorder bitrate in bits per second */
    DEFAULT_MEDIA_RECORDER_BPS: 192000,
} as const;

// ============================================================================
// FLAC ENCODING CONSTANTS
// ============================================================================

export const FLAC_ENCODING = {
    /**
     * libFLAC compression level (0 = fastest/largest, 8 = slowest/smallest).
     * Level 5 is the FLAC default: a good speed/size balance and lossless either way.
     */
    COMPRESSION_LEVEL: 5,

    /** Bit depth used when encoding the (16-bit PCM) processed buffer to FLAC */
    BITS_PER_SAMPLE: 16,
} as const;

// ============================================================================
// BIT DEPTH CONSTANTS
// ============================================================================

export const BIT_DEPTH = {
    /** Bit depth estimation boundaries (bytes per sample * 8) */
    BOUNDARIES: {
        /** <= 12 → 8-bit */
        EIGHT_BIT: 12,
        /** <= 20 → 16-bit */
        SIXTEEN_BIT: 20,
        /** <= 28 → 24-bit */
        TWENTY_FOUR_BIT: 28,
        /** > 28 → 32-bit */
    },

    /** Lossless formats that have meaningful bit depth */
    LOSSLESS_FORMATS: ["wav", "wave", "aiff", "aif", "aifc", "flac"] as const,
} as const;

// ============================================================================
// VIEWPORT / LAYOUT CONSTANTS
// ============================================================================

export const VIEWPORT = {
    /**
     * Minimum viewport width (px) Reverie is offered at. The cockpit - effects
     * rail, holographic waveform and mood rail - only lines up on a real desktop
     * canvas (the 3-column grid activates at Tailwind's `lg`, 1024px). Below this
     * we gate to a branded "come back on a bigger screen" stage instead of
     * shipping a cramped mobile layout. Width-based and matched to `lg`.
     */
    MIN_DESKTOP_WIDTH: 1024,
    /**
     * Below this between-rails height (px, matching --col-max-h), the cockpit
     * enters its short-height mode: the centre's two stacked plates (track identity
     * + waveform) reflow SIDE BY SIDE (when wide enough - see CENTER_SPLIT_MIN_WIDTH)
     * instead of running the stack into the transport rail, and the consoles drop
     * their supporting hint lines (`.console-hint`) so every panel stays compact and
     * legible. One threshold drives both, so nothing switches out of step and no
     * panel is left half-clipped in an in-between band. avail = viewport - the top
     * and bottom rails - main's padding, so this sits ~232px below the window height.
     */
    CONSOLE_SHORT_HEIGHT: 552,
    /**
     * Minimum viewport width (px) for that short-height side-by-side centre reflow.
     * Splitting the centre column spends its width on two tracks; below this there
     * isn't enough to leave the waveform a usable width, so the centre stays stacked
     * (and leans on the shrink + clip fallback) even when it's short.
     */
    CENTER_SPLIT_MIN_WIDTH: 1280,
} as const;

// ============================================================================
// FILE FORMAT CONSTANTS
// ============================================================================

export const FILE_FORMATS = {
    /**
     * Maximum accepted upload size in bytes. Decoding happens in-memory via the
     * Web Audio API, so an oversized file can exhaust the tab's memory. This caps
     * it with a clear error instead of crashing the tab (resilience + UX).
     */
    MAX_FILE_SIZE_BYTES: 200 * 1024 * 1024, // 200 MB

    /** Accepted audio MIME types for file upload */
    ACCEPTED_MIME_TYPES: [
        "audio/mpeg", // MP3
        "audio/mp3", // MP3 (alternative MIME)
        "audio/wav", // WAV
        "audio/wave", // WAV (alternative MIME)
        "audio/x-wav", // WAV (alternative MIME)
        "audio/ogg", // OGG Vorbis
        "audio/opus", // Opus
        "audio/mp4", // MP4/M4A
        "audio/m4a", // M4A
        "audio/x-m4a", // M4A (alternative MIME)
        "audio/aac", // AAC
        "audio/aacp", // AAC+
        "audio/flac", // FLAC
        "audio/x-flac", // FLAC (alternative MIME)
        "audio/webm", // WebM
        "audio/aiff", // AIFF
        "audio/x-aiff", // AIFF (alternative MIME)
        "audio/aifc", // AIFF-C
        "audio/3gpp", // 3GPP
        "audio/3gpp2", // 3GPP2
        "audio/amr", // AMR
    ] as const,

    /** File extensions mapped to format categories */
    EXTENSIONS: {
        WAV: ["wav", "wave"] as const,
        MP3: ["mp3"] as const,
        AIFF: ["aiff", "aif", "aifc"] as const,
        FLAC: ["flac"] as const,
        WEBM: ["webm"] as const,
        OGG: ["ogg", "opus", "oga"] as const,
        M4A: ["m4a", "aac", "mp4"] as const,
    },
} as const;

// ============================================================================
// METADATA EXTRACTION CONSTANTS
// ============================================================================

export const METADATA_EXTRACTION = {
    /** File header sizes for various formats (in bytes) */
    HEADER_SIZES: {
        WAV: 44,
        AIFF: 54,
        FLAC: 42,
        MP3_SEARCH: 4096, // Search first 4KB for MP3 frame
    },

    /** MP3 sample rates by MPEG version and index */
    MP3_SAMPLE_RATES: [
        [11025, 12000, 8000], // MPEG 2.5
        [0, 0, 0], // reserved
        [22050, 24000, 16000], // MPEG 2
        [44100, 48000, 32000], // MPEG 1
    ] as const,

    /** MP3 frame sync byte pattern */
    MP3_FRAME_SYNC: 0xff,

    /** MP3 frame sync mask for second byte */
    MP3_FRAME_SYNC_MASK: 0xe0,
} as const;

// ============================================================================
// MEDIARECORDER FORMAT MAP
// ============================================================================

export const MEDIA_RECORDER_FORMATS = {
    /** MIME type candidates for each format (in priority order) */
    MIME_TYPE_MAP: {
        webm: ["audio/webm;codecs=opus", "audio/webm"],
        ogg: ["audio/ogg;codecs=opus", "audio/ogg;codecs=vorbis", "audio/ogg"],
        opus: ["audio/ogg;codecs=opus", "audio/webm;codecs=opus"],
        m4a: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
        aac: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
        mp4: ["audio/mp4;codecs=mp4a.40.2", "audio/mp4"],
    } as const,
} as const;

// ============================================================================
// WAVEFORM VISUALIZATION CONSTANTS
// ============================================================================

export const WAVEFORM = {
    /** Number of bars to display in waveform timeline */
    BAR_COUNT: 96,

    /** Minimum number of bars to display */
    MIN_BAR_COUNT: 24,

    /** Minimum bar height percentage */
    MIN_BAR_HEIGHT_PERCENT: 8,

    /** Width (px) of the left/right edge zones that trigger auto-scroll while scrubbing an overflowing clip */
    EDGE_SCROLL_ZONE_PX: 48,

    /** Peak auto-scroll speed (px per frame) reached at the very edge of the viewport */
    EDGE_SCROLL_MAX_SPEED: 16,
} as const;

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
    /** File loading errors */
    LOAD_FAILED: "Failed to load audio file",
    NO_AUDIO_TO_PLAY: "No audio to play",
    FILE_TOO_LARGE: (maxMb: number) =>
        `File is too large. Maximum size is ${maxMb} MB`,

    /** Processing errors */
    PROCESS_FAILED: "Failed to process audio",

    /** Export errors */
    EXPORT_FAILED: "Failed to export audio",
    NO_AUDIO_TO_EXPORT: "No audio to export",
    MIME_TYPE_NOT_SUPPORTED: (mimeType: string) =>
        `MIME type ${mimeType} is not supported by this browser`,
    MEDIA_RECORDER_ERROR: (event: unknown) => `MediaRecorder error: ${event}`,

    /** Metadata extraction warnings */
    METADATA_EXTRACTION_FAILED: (format: string) =>
        `Failed to extract metadata from ${format}`,
} as const;

// ============================================================================
// AUDIO EFFECT CONSTANTS
// ============================================================================

export const AUDIO_EFFECTS = {
    /** Bass boost filter frequencies (Hz) */
    BASS_BOOST: {
        LOWSHELF_FREQUENCY_HZ: 100,
        HIGHPASS_FREQUENCY_HZ: 40,
        PEAKING_FREQUENCY_HZ: 300,
        /**
         * Underwater muffle: a lowpass whose cutoff sweeps from transparent down to a
         * deep muffle as the amount grows, with a slow LFO wobble on the cutoff for the
         * "submerged" feel. Amount 0 leaves the cutoff at MAX (effectively bypassed).
         */
        UNDERWATER_CUTOFF_MAX_HZ: 18000,
        UNDERWATER_CUTOFF_MIN_HZ: 500,
        UNDERWATER_LFO_FREQUENCY_HZ: 0.25, // ~4 s period - a gentle swell, not a tremolo
        UNDERWATER_LFO_DEPTH_RATIO: 0.15, // wobble peaks at ±15% of the cutoff
    },

    /** Reverb settings */
    REVERB: {
        DECAY_RATE: 2, // Exponential decay factor
    },

    /** 8D audio settings */
    EIGHT_D: {
        AUTOMATION_POINTS_PER_SECOND: 60,
    },

    /**
     * 6-band listening equalizer. Applied to real-time playback only (never baked
     * into exports). Bands match the classic preset banks: a low shelf, four
     * peaking mids, and a high shelf. Order here is the canonical band order used
     * everywhere (preset gains, sliders, filter nodes).
     */
    EQUALIZER: {
        /** Per-band gain bounds in dB. */
        GAIN_MIN_DB: -12,
        GAIN_MAX_DB: 12,
        GAIN_STEP_DB: 1,
        /** Q for the peaking mids (shelves ignore Q). */
        PEAKING_Q: 1,
        /** localStorage keys for the persisted listening EQ. */
        GAINS_STORAGE_KEY: "reverie:eq-gains",
        PRESET_STORAGE_KEY: "reverie:eq-preset",
        /** One entry per band, in canonical order. */
        BANDS: [
            { label: "60", frequencyHz: 60, type: "lowshelf" },
            { label: "150", frequencyHz: 150, type: "peaking" },
            { label: "400", frequencyHz: 400, type: "peaking" },
            { label: "1K", frequencyHz: 1000, type: "peaking" },
            { label: "2.4K", frequencyHz: 2400, type: "peaking" },
            { label: "15K", frequencyHz: 15000, type: "highshelf" },
        ],
    },
} as const;

// ============================================================================
// NIGHTCORE BEAT BED (engine)
// ============================================================================

export const NIGHTCORE = {
    /**
     * Public URLs for the one-shot samples (served from /public/sounds). Built from
     * BASE_URL so they resolve under Vite's production base ('/reverie/') instead of
     * the site root - a hardcoded '/sounds/...' 404s on GitHub Pages.
     */
    SAMPLES: {
        kick: `${import.meta.env.BASE_URL}sounds/nightcore-kick.wav`,
        clap: `${import.meta.env.BASE_URL}sounds/nightcore-clap.wav`,
        finish: `${import.meta.env.BASE_URL}sounds/nightcore-finish.wav`,
    },
    /**
     * Per-role level trims so the pre-rendered samples sit together (the crash matches
     * the clap). Applied on top of the user's independent beat volume.
     */
    ROLE_GAINS: {
        kick: 1.0,
        clap: 0.9,
        finish: 0.9,
    },
    /**
     * Which beats-in-bar carry the kick and the clap, per detected meter. 4/4 is the
     * osu! Nightcore staple (kick on 1 & 3, clap on 2 & 4); 3/4 is a waltz feel
     * (boom-tap-tap: kick on 1, clap on 2 & 3). The meter comes from tempo detection.
     */
    PATTERNS: {
        3: { KICK_BEATS: [0], CLAP_BEATS: [1, 2] },
        4: { KICK_BEATS: [0, 2], CLAP_BEATS: [1, 3] },
    },
    /** Crash/finish cadence: the downbeat of every 4th bar, whatever the meter. */
    FINISH_EVERY_BARS: 4,
    /**
     * Perceived-attack alignment. A one-shot's audible transient isn't at sample 0, so
     * firing it exactly on the beat lands the *hit* a few ms late. We measure each
     * sample's attack (its first rise to ATTACK_THRESHOLD_RATIO of the early-window
     * peak) and start it that much early, so the transient - not the buffer head - sits
     * on the grid. This applies to the kick too: the grid is phased to the track's own
     * drum *attacks* (refineDownbeat), so click-on-click is what reads as tight -
     * peak-aligning the kick's sub body was measured to flam its click ~11 ms ahead of
     * the music's. Capped at MAX_ALIGN_SECONDS so a slow-swell sample can't yank the
     * hit wildly early.
     */
    ATTACK_THRESHOLD_RATIO: 0.5,
    MAX_ALIGN_SECONDS: 0.05,
    /**
     * Lookahead scheduler (Web Audio "A Tale of Two Clocks"): a short JS timer wakes
     * up every TICK_MS and schedules any beat whose audio-clock time lands within the
     * next SCHEDULE_AHEAD_SECONDS, so timing rides the sample-accurate audio clock,
     * not setInterval jitter. The window is kept small so a live speed change re-anchors
     * within ~one tick.
     */
    SCHEDULE_AHEAD_SECONDS: 0.12,
    TICK_MS: 25,
} as const;

// ============================================================================
// TEMPO DETECTION
// ============================================================================

export const TEMPO_DETECTION = {
    /**
     * Search range for the estimated BPM. Autocorrelation peaks are weighted toward
     * PREFERRED_BPM (a log-Gaussian) so a track's half/double tempo doesn't win the
     * octave - the classic failure mode of raw autocorrelation.
     */
    MIN_BPM: 70,
    MAX_BPM: 180,
    PREFERRED_BPM: 120,
    /** Width (in octaves) of the tempo preference curve. */
    PREFERENCE_OCTAVES: 0.9,
    /** Onset-envelope hop in samples (~11 ms at 44.1 kHz) → envelope frame rate. */
    HOP_SIZE: 512,
    /**
     * The beat phase (downbeat) is measured from a low-passed copy of the track: the
     * kick drum lives below this cutoff, so phasing the grid to the low-band onsets
     * lands our kick on the real kicks - not on the louder backbeat snare, which is
     * what pulls a full-band phase estimate onto the offbeat.
     */
    KICK_LOWPASS_HZ: 150,
    /** Fallback tempo when the track is too flat/silent to estimate one. */
    DEFAULT_BPM: 120,
    /**
     * Fractional-BPM refinement. The autocorrelation picks an *integer* envelope lag,
     * which quantizes the tempo in steps of roughly 1-3 BPM over the search range, and
     * envelope smearing can pull the peak a further whole lag off. Either error
     * compounds: at 90 BPM a 2.5% miss drifts the grid a full beat every ~26 s. So the
     * coarse pick is refined by sweeping a harmonic comb of the onset envelope's DFT -
     * the summed energy at 1×..HARMONICS× the beat frequency - over ±RANGE_RATIO
     * around it (wide enough to cover a whole-lag miss, far too narrow to jump an
     * octave), first at COARSE_STEP_BPM then at FINE_STEP_BPM around the winner.
     * The comb matters: much of a groove's periodic energy rides the beat's
     * subdivisions (hi-hat eighths at 2×, etc.), and the fundamental bin alone was
     * measured 0.2 BPM off on real material where the comb lands within ~0.01 BPM -
     * drift-free over a full-length track.
     */
    REFINE_RANGE_RATIO: 0.04,
    REFINE_COARSE_STEP_BPM: 0.1,
    REFINE_FINE_STEP_BPM: 0.005,
    REFINE_HARMONICS: 4,
    /**
     * Octave/meter re-ranking. The autocorrelation's winning lag is often a metrical
     * *relative* of the beat rather than the beat itself - the 2-beat lag (a backbeat
     * pattern repeats every two beats), the dotted quarter, the bar. The preference
     * weight alone can't save this: those lags genuinely correlate as strongly as the
     * beat (measured: a 150 BPM track whose 2-beat lag out-scored the beat lag and shipped
     * a half-tempo grid). So each metrical relative of the ACF pick that lands inside
     * MIN..MAX_BPM is refined and re-scored by its harmonic-comb energy × the same
     * tempo preference, and the strongest comb wins. The comb is the right judge because
     * the true beat's comb collects the groove's whole subdivision ladder (beat, 8ths,
     * 16ths), while a relative's comb only ever captures a slice of it.
     */
    OCTAVE_CANDIDATE_RATIOS: [
        1,
        2,
        1 / 2,
        3,
        1 / 3,
        3 / 2,
        2 / 3,
        4 / 3,
        3 / 4,
    ],
    /**
     * Meter detection (3/4 vs 4/4). Once the beat grid is found, a beat-synchronous
     * accent series is autocorrelated at the two bar-length lags - triple time (3) and
     * quadruple time (4) - and the lag with the stronger self-similarity is the meter.
     * ACCENT_WINDOW_RATIO sizes the per-beat energy window (as a fraction of the beat).
     * Most music is 4/4, so triple only wins when it beats 4/4 by METER_TRIPLE_MARGIN,
     * and only once there are METER_MIN_BEATS beats to measure over.
     */
    METER_ACCENT_WINDOW_RATIO: 0.25,
    METER_MIN_BEATS: 12,
    METER_TRIPLE_MARGIN: 1.1,
    /** Meter assumed when there's too little signal to decide. */
    DEFAULT_BEATS_PER_BAR: 4,
    /**
     * Downbeat refinement. The onset-envelope phase reads a few ms early: the log-energy
     * flux front-loads the first rise out of silence, so the coarse downbeat lands ahead
     * of the true attack (the beats sound rushed). We snap it to the steepest kick-band
     * energy rise within DOWNBEAT_REFINE_RADIUS_SEC of the estimate, measuring the rise
     * over an ONSET_RISE_WINDOW_SEC energy window. The radius stays well under half a beat
     * (< the fastest MAX_BPM beat) so the grid can never jump to a neighbouring beat.
     */
    DOWNBEAT_REFINE_RADIUS_SEC: 0.03,
    ONSET_RISE_WINDOW_SEC: 0.01,
} as const;

// ============================================================================
// UI EFFECT CONTROL DEFAULTS
// ============================================================================

export const EFFECT_DEFAULTS = {
    /** Speed-up effect defaults */
    SPEED_UP: {
        DEFAULT: 1.2,
        MIN: 1.1,
        MAX: 2.0,
        STEP: 0.05,
    },

    /**
     * "Nightcore beats" - an optional 4/4 percussion bed layered under the Speed Up
     * effect (osu!-style): kick on 1 & 3, clap on 2 & 4, a crash every 4 bars. Off by
     * default so Speed Up stays a pure time-stretch.
     */
    NIGHTCORE_BEATS: {
        ENABLED_DEFAULT: false,
        /** Beat-bed level, independent of the track's master volume (0-1). */
        VOLUME_DEFAULT: 0.5,
        VOLUME_MIN: 0.0,
        VOLUME_MAX: 1.0,
        VOLUME_STEP: 0.01,
    },

    /** Slow-reverb effect defaults */
    SLOW_REVERB: {
        SPEED_DEFAULT: 0.9,
        SPEED_MIN: 0.5,
        SPEED_MAX: 0.9,
        SPEED_STEP: 0.05,
        REVERB_DEFAULT: 0.7,
        REVERB_MIN: 0.0,
        REVERB_MAX: 1.0,
        REVERB_STEP: 0.1,
    },

    /** 8D audio effect defaults */
    EIGHT_D_AUDIO: {
        ROTATION_DEFAULT: 0.4,
        ROTATION_MIN: 0.2,
        ROTATION_MAX: 1.5,
        ROTATION_STEP: 0.1,
    },

    /** Bass boost effect defaults */
    BASS_BOOST_UI: {
        // Defaults into the "Normal" band so the label reads "Normal" from the first
        // frame, with room to dial up (Strong) or down (Light).
        INTENSITY_DEFAULT: 0.4,
        INTENSITY_MIN: 0.0,
        INTENSITY_MAX: 1.0,
        INTENSITY_STEP: 0.01,
        /** Threshold for light bass intensity */
        LIGHT_THRESHOLD: 0.33,
        /** Threshold for normal bass intensity */
        NORMAL_THRESHOLD: 0.67,
        /** Underwater muffle amount (0 = off, surface; 1 = deeply submerged). */
        UNDERWATER_DEFAULT: 0.0,
        UNDERWATER_MIN: 0.0,
        UNDERWATER_MAX: 1.0,
        UNDERWATER_STEP: 0.01,
    },
} as const;

// ============================================================================
// EXPORT LABELS (English-only for filenames)
// ============================================================================

/**
 * English-only effect labels for exported filenames
 * These should NOT be translated to maintain consistent naming across languages
 */
export const EFFECT_EXPORT_LABELS = {
    none: "original",
    "speed-up": "sped-up",
    "slow-reverb": "slow+reverb",
    "8d-audio": "8D",
    "bass-boost": "bass-boosted",
} as const;

// ============================================================================
// AUDIO PROCESSING SIGNAL CONSTANTS
// ============================================================================

export const AUDIO_SIGNAL = {
    /** 8D audio mix ratios */
    EIGHT_D_MIX: {
        /** Rotating dry signal (panned) - the main music that orbits the head. */
        DRY_GAIN: 0.85,
        /**
         * Constant reverb bed (un-panned). Fed from the pre-pan signal so a quiet
         * ambience stays present in BOTH ears at all times - this prevents a "silent
         * void" from rotating opposite the music. Kept low so it sits under the music.
         */
        WET_GAIN: 0.22,
        STEREO_VARIATION_LEFT: 1.0,
        STEREO_VARIATION_RIGHT: 0.9,
    },

    /** PCM conversion constants */
    PCM: {
        /** Maximum negative value for 16-bit PCM */
        INT16_MIN: 0x8000,
        /** Maximum positive value for 16-bit PCM */
        INT16_MAX: 0x7fff,
    },

    /** WAV file format constants */
    WAV_FORMAT: {
        /** WAV header size in bytes */
        HEADER_SIZE: 44,
        /** PCM format code */
        PCM_FORMAT: 1,
        /** Format chunk size for PCM */
        FMT_CHUNK_SIZE: 16,
        /** Bits per sample for 16-bit PCM */
        BITS_PER_SAMPLE: 16,
    },
} as const;
