import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationToggle } from './DurationToggle';
import { resetDurationDisplayStores } from '../hooks/useDurationDisplayMode';
import { AUDIO_PROCESSING } from '../constants';

const FOOTER_KEY = AUDIO_PROCESSING.DURATION_DISPLAY_STORAGE_KEY_FOOTER;
const WAVEFORM_KEY = AUDIO_PROCESSING.DURATION_DISPLAY_STORAGE_KEY_WAVEFORM;

describe('DurationToggle', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDurationDisplayStores();
  });

  it('shows total duration by default and remaining after a click', () => {
    render(<DurationToggle duration={100} current={30} storageKey={FOOTER_KEY} />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-pressed', 'false');
    expect(button).toHaveTextContent('1:40');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('-1:10');
  });

  it('keeps each storage key independent and persists the choice', () => {
    render(
      <>
        <DurationToggle duration={100} current={30} storageKey={FOOTER_KEY} />
        <DurationToggle duration={100} current={30} storageKey={WAVEFORM_KEY} />
      </>
    );
    const [footer, waveform] = screen.getAllByRole('button');

    fireEvent.click(footer);

    // Flipping the footer must NOT flip the waveform toggle...
    expect(footer).toHaveAttribute('aria-pressed', 'true');
    expect(waveform).toHaveAttribute('aria-pressed', 'false');
    // ...and only the footer's preference is written to storage.
    expect(localStorage.getItem(FOOTER_KEY)).toBe('true');
    expect(localStorage.getItem(WAVEFORM_KEY)).toBeNull();
  });
});
