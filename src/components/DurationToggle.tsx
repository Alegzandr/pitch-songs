import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatClock } from '../utils/formatters';

interface DurationToggleProps {
  duration: number;
  /** Displayed playhead time (whole seconds), sourced by the host from its clock. */
  current: number;
  className?: string;
}

/**
 * The trailing clock button: click to flip between total duration and time
 * remaining. Each instance owns its own state, so the panel and the footer
 * toggles can be set independently.
 */
export function DurationToggle({ duration, current, className = '' }: DurationToggleProps) {
  const { t } = useTranslation();
  const [showRemaining, setShowRemaining] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setShowRemaining((v) => !v)}
      className={className}
      aria-label={t('waveform.toggleRemaining')}
      aria-pressed={showRemaining}
    >
      {showRemaining ? `-${formatClock(duration - current)}` : formatClock(duration)}
    </button>
  );
}
