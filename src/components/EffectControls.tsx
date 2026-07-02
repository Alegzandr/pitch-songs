import { memo, useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Zap, Waves, Radio, Volume2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { prefersReducedMotion } from "./scenes/motion";
import { EffectSlider } from "./EffectSlider";
import { EffectRow } from "./EffectRow";
import { BeatToggle } from "./BeatToggle";
import { LevelMeter } from "./LevelMeter";
import { EFFECT_DEFAULTS } from "../constants";
import {
    formatSpeedMultiplier,
    formatPercentage,
    formatBassIntensityLabel,
} from "../utils/formatters";

export type EffectMode =
    | "none"
    | "speed-up"
    | "slow-reverb"
    | "8d-audio"
    | "bass-boost";

export interface EffectSettings {
    speedMultiplier: number;
    reverbAmount: number;
    rotationSpeed?: number;
    bassBoostIntensity?: number;
    bassUnderwater?: number;
    // Nightcore beat bed (Speed Up only).
    enableBeats?: boolean;
    beatsVolume?: number;
    mode: EffectMode;
}

interface EffectControlsProps {
    onChange: (settings: EffectSettings) => void;
    disabled?: boolean;
    // Seeds the internal state on mount. Lets a parent restore the live settings
    // when this component is remounted (e.g. the desktop gate flips during a
    // window drag), instead of snapping back to the slow-reverb defaults.
    initialSettings?: EffectSettings;
}

// Listed effects - Slow + Reverb leads as the signature late-night mood. There is
// no "Original" row: the untouched track ("none") is the *absence* of an active
// effect, reached by powering off whichever effect is currently Active.
const EFFECT_DEFS: { mode: EffectMode; icon: LucideIcon; labelKey: string }[] = [
    { mode: "slow-reverb", icon: Waves, labelKey: "effects.slowReverb" },
    { mode: "speed-up", icon: Zap, labelKey: "effects.speedUp" },
    { mode: "8d-audio", icon: Radio, labelKey: "effects.8dAudio" },
    { mode: "bass-boost", icon: Volume2, labelKey: "effects.bassBoost" },
];

export const EffectControls = memo(function EffectControls({ onChange, disabled, initialSettings }: EffectControlsProps) {
    const { t } = useTranslation();
    // Slow + Reverb leads - the brand's signature late-night mood, and the first
    // effect listed, so the Active row sits at the top on load. `initialSettings`
    // (when provided) overrides these seeds for the active mode's parameters so a
    // remount restores the live values instead of resetting to defaults.
    const [mode, setMode] = useState<EffectMode>(
        initialSettings?.mode ?? "slow-reverb"
    );
    const [speedMultiplier, setSpeedMultiplier] = useState<number>(
        initialSettings?.mode === "speed-up"
            ? initialSettings.speedMultiplier
            : EFFECT_DEFAULTS.SPEED_UP.DEFAULT
    );
    const [slowSpeed, setSlowSpeed] = useState<number>(
        initialSettings?.mode === "slow-reverb"
            ? initialSettings.speedMultiplier
            : EFFECT_DEFAULTS.SLOW_REVERB.SPEED_DEFAULT
    );
    const [reverbAmount, setReverbAmount] = useState<number>(
        initialSettings?.mode === "slow-reverb"
            ? initialSettings.reverbAmount
            : EFFECT_DEFAULTS.SLOW_REVERB.REVERB_DEFAULT
    );
    const [rotationSpeed, setRotationSpeed] = useState<number>(
        initialSettings?.rotationSpeed ??
            EFFECT_DEFAULTS.EIGHT_D_AUDIO.ROTATION_DEFAULT
    );
    const [bassBoostIntensity, setBassBoostIntensity] = useState<number>(
        initialSettings?.bassBoostIntensity ??
            EFFECT_DEFAULTS.BASS_BOOST_UI.INTENSITY_DEFAULT
    );
    const [bassUnderwater, setBassUnderwater] = useState<number>(
        initialSettings?.bassUnderwater ??
            EFFECT_DEFAULTS.BASS_BOOST_UI.UNDERWATER_DEFAULT
    );
    const [enableBeats, setEnableBeats] = useState<boolean>(
        initialSettings?.enableBeats ??
            EFFECT_DEFAULTS.NIGHTCORE_BEATS.ENABLED_DEFAULT
    );
    const [beatsVolume, setBeatsVolume] = useState<number>(
        initialSettings?.beatsVolume ??
            EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_DEFAULT
    );

    useEffect(() => {
        if (mode === "none") {
            // Bypass: play the untouched track - no time-stretch, no reverb, no spatialiser.
            onChange({ mode: "none", speedMultiplier: 1, reverbAmount: 0 });
        } else if (mode === "speed-up") {
            onChange({
                mode: "speed-up",
                speedMultiplier,
                reverbAmount: 0,
                enableBeats,
                beatsVolume,
            });
        } else if (mode === "slow-reverb") {
            onChange({
                mode: "slow-reverb",
                speedMultiplier: slowSpeed,
                reverbAmount,
            });
        } else if (mode === "8d-audio") {
            onChange({
                mode: "8d-audio",
                speedMultiplier: 1,
                reverbAmount: 0,
                rotationSpeed,
            });
        } else {
            onChange({
                mode: "bass-boost",
                speedMultiplier: 1,
                reverbAmount: 0,
                bassBoostIntensity,
                bassUnderwater,
            });
        }
    }, [
        mode,
        speedMultiplier,
        slowSpeed,
        reverbAmount,
        rotationSpeed,
        bassBoostIntensity,
        bassUnderwater,
        enableBeats,
        beatsVolume,
        onChange,
    ]);

    // The beats volume slider appears BELOW the toggle, which sits near the bottom
    // of the console's internal scroll area - on short viewports the revealed
    // control would land entirely under the fold and the user would never see it.
    // When the toggle flips on (not on a restored mount), bring it into view.
    const beatsSliderRef = useRef<HTMLDivElement | null>(null);
    const prevEnableBeatsRef = useRef(enableBeats);
    useEffect(() => {
        const was = prevEnableBeatsRef.current;
        prevEnableBeatsRef.current = enableBeats;
        if (!enableBeats || was) return;
        // Optional call: jsdom (tests) doesn't implement scrollIntoView.
        beatsSliderRef.current?.scrollIntoView?.({
            block: "nearest",
            behavior: prefersReducedMotion() ? "auto" : "smooth",
        });
    }, [enableBeats]);

    // Effects are exclusive: selecting an inactive one makes it Active. Clicking the
    // *already-active* effect powers it off, dropping back to "none" - the untouched
    // track. "Original" is therefore a state, never a row.
    const handleSelect = (next: EffectMode) => {
        setMode((current) => (current === next ? "none" : next));
    };

    const bassIntensityLabel = formatBassIntensityLabel(
        bassBoostIntensity,
        EFFECT_DEFAULTS.BASS_BOOST_UI.LIGHT_THRESHOLD,
        EFFECT_DEFAULTS.BASS_BOOST_UI.NORMAL_THRESHOLD,
        {
            light: t("effects.bassLight"),
            normal: t("effects.bassNormal"),
            strong: t("effects.bassStrong"),
        }
    );

    // The slider(s) each mode exposes, and (via `meterIndex`) which one drives the
    // reactive VU-meter so the readout tracks the setting as you turn it.
    const D = EFFECT_DEFAULTS;
    const modeSliders: Record<
        Exclude<EffectMode, "none">,
        {
            meterIndex: number;
            sliders: {
                id: string;
                label: string;
                value: number;
                onChange: (value: number) => void;
                defaultValue: number;
                min: number;
                max: number;
                step: number;
                formatValue: (value: number) => string;
                markers: string[];
            }[];
        }
    > = {
        "speed-up": {
            meterIndex: 0,
            sliders: [
                {
                    id: "speed-slider",
                    label: t("effects.speed"),
                    value: speedMultiplier,
                    onChange: setSpeedMultiplier,
                    defaultValue: D.SPEED_UP.DEFAULT,
                    min: D.SPEED_UP.MIN,
                    max: D.SPEED_UP.MAX,
                    step: D.SPEED_UP.STEP,
                    formatValue: (v) => formatSpeedMultiplier(v, 2),
                    markers: [
                        `${D.SPEED_UP.MIN.toFixed(2)}x`,
                        `${D.SPEED_UP.MAX.toFixed(2)}x`,
                    ],
                },
            ],
        },
        "slow-reverb": {
            meterIndex: 1,
            sliders: [
                {
                    id: "slow-speed-slider",
                    label: t("effects.slowSpeed"),
                    value: slowSpeed,
                    onChange: setSlowSpeed,
                    defaultValue: D.SLOW_REVERB.SPEED_DEFAULT,
                    min: D.SLOW_REVERB.SPEED_MIN,
                    max: D.SLOW_REVERB.SPEED_MAX,
                    step: D.SLOW_REVERB.SPEED_STEP,
                    formatValue: (v) => formatSpeedMultiplier(v, 2),
                    markers: [
                        `${D.SLOW_REVERB.SPEED_MIN.toFixed(2)}x`,
                        `${D.SLOW_REVERB.SPEED_DEFAULT.toFixed(2)}x`,
                        `${D.SLOW_REVERB.SPEED_MAX.toFixed(2)}x`,
                    ],
                },
                {
                    id: "reverb-slider",
                    label: t("effects.reverb"),
                    value: reverbAmount,
                    onChange: setReverbAmount,
                    defaultValue: D.SLOW_REVERB.REVERB_DEFAULT,
                    min: D.SLOW_REVERB.REVERB_MIN,
                    max: D.SLOW_REVERB.REVERB_MAX,
                    step: D.SLOW_REVERB.REVERB_STEP,
                    formatValue: formatPercentage,
                    markers: [
                        `${Math.round(D.SLOW_REVERB.REVERB_MIN * 100)}%`,
                        `${Math.round(D.SLOW_REVERB.REVERB_MAX * 100)}%`,
                    ],
                },
            ],
        },
        "8d-audio": {
            meterIndex: 0,
            sliders: [
                {
                    id: "rotation-slider",
                    label: t("effects.rotationSpeed"),
                    value: rotationSpeed,
                    onChange: setRotationSpeed,
                    defaultValue: D.EIGHT_D_AUDIO.ROTATION_DEFAULT,
                    min: D.EIGHT_D_AUDIO.ROTATION_MIN,
                    max: D.EIGHT_D_AUDIO.ROTATION_MAX,
                    step: D.EIGHT_D_AUDIO.ROTATION_STEP,
                    formatValue: formatSpeedMultiplier,
                    markers: [
                        `${D.EIGHT_D_AUDIO.ROTATION_MIN}x`,
                        `${D.EIGHT_D_AUDIO.ROTATION_MAX}x`,
                    ],
                },
            ],
        },
        "bass-boost": {
            meterIndex: 0,
            sliders: [
                {
                    id: "bass-slider",
                    label: t("effects.bassIntensity"),
                    value: bassBoostIntensity,
                    onChange: setBassBoostIntensity,
                    defaultValue: D.BASS_BOOST_UI.INTENSITY_DEFAULT,
                    min: D.BASS_BOOST_UI.INTENSITY_MIN,
                    max: D.BASS_BOOST_UI.INTENSITY_MAX,
                    step: D.BASS_BOOST_UI.INTENSITY_STEP,
                    formatValue: () => bassIntensityLabel,
                    markers: [t("effects.bassLight"), t("effects.bassStrong")],
                },
                {
                    id: "underwater-slider",
                    label: t("effects.underwater"),
                    value: bassUnderwater,
                    onChange: setBassUnderwater,
                    defaultValue: D.BASS_BOOST_UI.UNDERWATER_DEFAULT,
                    min: D.BASS_BOOST_UI.UNDERWATER_MIN,
                    max: D.BASS_BOOST_UI.UNDERWATER_MAX,
                    step: D.BASS_BOOST_UI.UNDERWATER_STEP,
                    formatValue: formatPercentage,
                    markers: [
                        t("effects.underwaterSurface"),
                        t("effects.underwaterDeep"),
                    ],
                },
            ],
        },
    };

    const active = mode === "none" ? null : modeSliders[mode];
    const meterSlider = active?.sliders[active.meterIndex];
    const activeLevel =
        meterSlider && meterSlider.max > meterSlider.min
            ? (meterSlider.value - meterSlider.min) / (meterSlider.max - meterSlider.min)
            : 0;

    return (
        <div className="flex flex-col gap-5">
            {/* Effects - exclusive modes listed as rows; the chosen one is Active. */}
            <div className="space-y-2.5">
                <span className="hud-readout block">{t("studio.effects")}</span>
                <div className="space-y-2">
                    {EFFECT_DEFS.map((fx) => (
                        <EffectRow
                            key={fx.mode}
                            icon={fx.icon}
                            label={t(fx.labelKey)}
                            mode={fx.mode}
                            active={mode === fx.mode}
                            disabled={disabled}
                            onSelect={handleSelect}
                            statusLabel={mode === fx.mode ? t("studio.active") : t("studio.inactive")}
                        />
                    ))}
                </div>
            </div>

            {/* Adjustments - the single clear control(s) for the Active effect.
               Keyed on `mode` so switching re-mounts and the new control eases in:
               motion that signals the state change, not decoration. */}
            <div className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                    <span className="hud-readout">{t("studio.adjustments")}</span>
                    {/* Reactive VU-meter: fills to the active effect's parameter. */}
                    <LevelMeter value={activeLevel} variant="reactive" className="h-4 w-24" />
                </div>
                <div className="hud-ruler" aria-hidden="true" />
                <div
                    key={mode}
                    className="pt-1 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
                >
                    {active ? (
                        <div className="space-y-6">
                            {active.sliders.map((slider) => (
                                <EffectSlider key={slider.id} {...slider} disabled={disabled} />
                            ))}
                            {mode === "speed-up" && (
                                <div className="space-y-4 border-t border-[rgba(var(--color-border),0.4)] pt-5">
                                    <BeatToggle
                                        label={t("effects.nightcoreBeats")}
                                        description={t("effects.nightcoreBeatsHint")}
                                        pressed={enableBeats}
                                        onToggle={() => setEnableBeats((v) => !v)}
                                        disabled={disabled}
                                    />
                                    {enableBeats && (
                                        <div
                                            ref={beatsSliderRef}
                                            className="space-y-5 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300"
                                        >
                                            <EffectSlider
                                                id="beats-volume-slider"
                                                label={t("effects.beatVolume")}
                                                value={beatsVolume}
                                                onChange={setBeatsVolume}
                                                defaultValue={EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_DEFAULT}
                                                min={EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_MIN}
                                                max={EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_MAX}
                                                step={EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_STEP}
                                                formatValue={formatPercentage}
                                                markers={[
                                                    `${Math.round(EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_MIN * 100)}%`,
                                                    `${Math.round(EFFECT_DEFAULTS.NIGHTCORE_BEATS.VOLUME_MAX * 100)}%`,
                                                ]}
                                                disabled={disabled}
                                            />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    ) : (
                        <p className="py-2 text-sm text-[rgb(var(--color-text-secondary))]">
                            {t("effects.originalHint")}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
});
