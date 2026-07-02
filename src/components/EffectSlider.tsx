import { useTranslation } from "react-i18next";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useDoubleClickReset } from "@/hooks/useDoubleClickReset";

interface EffectSliderProps {
    id: string;
    label: string;
    value: number;
    /** Factory-set value; double-clicking the slider snaps back to it. */
    defaultValue: number;
    min: number;
    max: number;
    step: number;
    disabled?: boolean;
    onChange: (value: number) => void;
    formatValue: (value: number) => string;
    markers?: string[];
}

/**
 * One clear control per effect. The track fills with the Aurora accent up to the
 * current value (driven by the --range custom property), and the value is rendered
 * large so the result, not the mechanism, leads.
 *
 * Double-clicking the track restores the default value - a quick escape from a
 * dialed-in setting without nudging the thumb back by hand.
 */
export function EffectSlider({
    id,
    label,
    value,
    defaultValue,
    min,
    max,
    step,
    disabled,
    onChange,
    formatValue,
    markers,
}: EffectSliderProps) {
    const { t } = useTranslation();
    const formattedValue = formatValue(value);
    const handleDoubleClickReset = useDoubleClickReset(
        () => onChange(defaultValue),
        !disabled,
    );

    return (
        <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
                <label
                    htmlFor={id}
                    className="text-sm font-medium text-[rgb(var(--color-text-secondary))]"
                >
                    {label}
                </label>
                <span
                    className="text-2xl font-semibold tabular-nums text-[rgb(var(--color-accent-text))]"
                    aria-live="polite"
                >
                    {formattedValue}
                </span>
            </div>
            <Tooltip>
                <TooltipTrigger asChild>
                    <Slider
                        id={id}
                        min={min}
                        max={max}
                        step={step}
                        value={value}
                        onValueChange={onChange}
                        onClick={handleDoubleClickReset}
                        disabled={disabled}
                        aria-label={`${label}: ${formattedValue}`}
                    />
                </TooltipTrigger>
                <TooltipContent>{t("effects.resetHint")}</TooltipContent>
            </Tooltip>
            {markers && (
                <div className="flex justify-between text-xs text-[rgb(var(--color-text-secondary))]">
                    {markers.map((marker, index) => (
                        <span key={index}>{marker}</span>
                    ))}
                </div>
            )}
        </div>
    );
}
