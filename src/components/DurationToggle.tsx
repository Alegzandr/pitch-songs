import { useTranslation } from 'react-i18next';
import { formatClock } from '../utils/formatters';
import { useDurationDisplayMode, toggleDurationDisplay } from '../hooks/useDurationDisplayMode';

interface DurationToggleProps {
  duration: number;
  /** Displayed playhead time (whole seconds), sourced by the host from its clock. */
  current: number;
  /** Storage key identifying this toggle's own persisted preference (kept independent per host). */
  storageKey: string;
  className?: string;
}

/**
 * The trailing clock button: click to flip between total duration and time
 * remaining. The mode is a persisted preference scoped to storageKey (see
 * useDurationDisplayMode), so each host (footer, waveform header) keeps its own
 * choice independently and remembers it across reloads.
 */
export function DurationToggle({ duration, current, storageKey, className = '' }: DurationToggleProps) {
  const { t } = useTranslation();
  const showRemaining = useDurationDisplayMode(storageKey);
  return (
    <button
      type="button"
      onClick={() => toggleDurationDisplay(storageKey)}
      className={className}
      aria-label={t('waveform.toggleRemaining')}
      aria-pressed={showRemaining}
    >
      {showRemaining ? `-${formatClock(duration - current)}` : formatClock(duration)}
    </button>
  );
}
