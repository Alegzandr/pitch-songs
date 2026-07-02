import { memo } from "react";
import { cn } from "@/lib/utils";

interface BeatToggleProps {
    label: string;
    /** Optional status chip rendered after the label (e.g. "Beta"). */
    badge?: string;
    /** Optional supporting line under the label (e.g. the detected tempo). */
    description?: string;
    /** Extra classes on the description line - e.g. to hide it at short heights. */
    descriptionClassName?: string;
    pressed: boolean;
    onToggle: () => void;
    disabled?: boolean;
}

/**
 * A labelled switch row for the Nightcore beat options. Mirrors the EffectRow look
 * (bordered pill, accent when on) but reads as a binary switch: role="switch" plus a
 * sliding thumb, so the on/off state is never carried by colour alone.
 */
export const BeatToggle = memo(function BeatToggle({
    label,
    badge,
    description,
    descriptionClassName,
    pressed,
    onToggle,
    disabled,
}: BeatToggleProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={pressed}
            aria-label={label}
            onClick={onToggle}
            disabled={disabled}
            className={cn(
                "ios-button group flex w-full items-center justify-between gap-3 rounded-2xl border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-[rgb(var(--color-background))] disabled:opacity-50",
                pressed
                    ? "border-[rgba(var(--color-accent),0.55)] bg-[rgba(var(--color-accent),0.12)]"
                    : "border-[rgba(var(--color-border),0.55)] hover:border-[rgba(var(--color-accent),0.4)] hover:bg-[rgba(var(--color-surface),0.5)]"
            )}
        >
            <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-semibold text-[rgb(var(--color-text))]">
                        {label}
                    </span>
                    {badge && (
                        <span className="shrink-0 rounded-full border border-[rgba(var(--color-accent),0.4)] bg-[rgba(var(--color-accent),0.1)] px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-[rgb(var(--color-accent-text))]">
                            {badge}
                        </span>
                    )}
                </span>
                {description && (
                    <span
                        className={cn(
                            "block truncate text-xs text-[rgb(var(--color-text-secondary))]",
                            descriptionClassName
                        )}
                    >
                        {description}
                    </span>
                )}
            </span>
            <span
                aria-hidden="true"
                className={cn(
                    "relative h-5 w-9 shrink-0 rounded-full transition-colors",
                    pressed
                        ? "bg-[rgb(var(--color-accent))]"
                        : "bg-[rgba(var(--color-border),0.8)]"
                )}
            >
                <span
                    className={cn(
                        "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform",
                        pressed ? "translate-x-4" : "translate-x-0.5"
                    )}
                />
            </span>
        </button>
    );
});
