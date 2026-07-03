import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, beforeEach, expect } from 'vitest';
import { SettingsMenu } from './SettingsMenu';
import { TooltipProvider } from './ui/tooltip';

const mockChangeLanguage = vi.fn();
const mockI18n = { language: 'en', changeLanguage: mockChangeLanguage };
const mockSetPreset = vi.fn();
const mockSetBandGain = vi.fn();
const mockReset = vi.fn();

vi.mock('react-i18next', () => ({
  // Echo the key, folding the interpolated frequency in so each band's
  // aria-label stays unique (settings.eqBand:60Hz, …).
  useTranslation: () => ({
    t: (key: string, opts?: { freq?: string }) => (opts?.freq ? `${key}:${opts.freq}` : key),
    i18n: mockI18n,
  }),
}));

vi.mock('../contexts/EqContext', () => ({
  useEq: () => ({
    gains: [0, 0, 0, 0, 0, 0],
    presetName: 'Flat',
    setPreset: mockSetPreset,
    setBandGain: mockSetBandGain,
    reset: mockReset,
  }),
}));

const renderMenu = () =>
  render(
    <TooltipProvider>
      <SettingsMenu />
    </TooltipProvider>
  );

describe('SettingsMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockI18n.language = 'en';
  });

  it('opens the menu and switches language', async () => {
    renderMenu();

    await userEvent.click(screen.getByLabelText('settings.open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Español/ }));
    expect(mockChangeLanguage).toHaveBeenCalledWith('es');
  });

  it('applies a preset from the equalizer picker', async () => {
    renderMenu();

    await userEvent.click(screen.getByLabelText('settings.open'));
    // Custom combobox: open the listbox, then pick an option.
    await userEvent.click(screen.getByRole('combobox', { name: 'settings.eqPreset' }));
    await userEvent.click(screen.getByRole('option', { name: 'Rock' }));
    expect(mockSetPreset).toHaveBeenCalledWith('Rock');
  });

  it('nudges a single equalizer band', async () => {
    renderMenu();

    await userEvent.click(screen.getByLabelText('settings.open'));
    // First band is 60Hz; dragging it sets that band's gain.
    fireEvent.change(screen.getByLabelText('settings.eqBand:60Hz'), { target: { value: '4' } });
    expect(mockSetBandGain).toHaveBeenCalledWith(0, 4);
  });

  it('resets a band to zero on double click', async () => {
    renderMenu();

    await userEvent.click(screen.getByLabelText('settings.open'));
    fireEvent.doubleClick(screen.getByLabelText('settings.eqBand:60Hz'));
    expect(mockSetBandGain).toHaveBeenCalledWith(0, 0);
  });
});
