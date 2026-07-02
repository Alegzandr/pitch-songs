import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, beforeEach, expect } from 'vitest';
import App from './App';
import { TooltipProvider } from './components/ui/tooltip';

// App no longer depends on a router (language lives in localStorage, not the URL).
// It does use shadcn Tooltips, which require a TooltipProvider ancestor (as in main.tsx).
const renderWithRouter = (ui: React.ReactElement) =>
  render(<TooltipProvider>{ui}</TooltipProvider>);

const mockState = {
  isLoading: false,
  isProcessing: false,
  isPlaying: false,
  progress: 0,
  error: null as string | null,
};

const mockApi = {
  state: mockState,
  originalFile: null as File | null,
  processedBuffer: null as AudioBuffer | null,
  originalBuffer: null as AudioBuffer | null,
  playbackClock: { get: () => 0, subscribe: () => () => {} },
  duration: 0,
  volume: 0.7,
  repeat: false,
  loadAudioFile: vi.fn(),
  setEffects: vi.fn(),
  setEq: vi.fn(),
  playAudio: vi.fn(),
  stopAudio: vi.fn(),
  exportProcessedAudio: vi.fn(async () => {}),
  updateVolume: vi.fn(),
  seekTo: vi.fn(),
  toggleRepeat: vi.fn(),
  reset: vi.fn(),
  getAnalyser: () => null,
  getLoudness: () => null,
};

const mockSetMood = vi.fn();
const mockSetPreset = vi.fn();
const mockI18n = { language: 'en', changeLanguage: vi.fn() };

vi.mock('./hooks/useAudioProcessor', () => ({
  useAudioProcessor: () => mockApi,
}));

vi.mock('./contexts/MoodContext', () => ({
  useMood: () => ({
    mood: 'light',
    def: { kind: 'workspace', scene: 'daybreak' },
    setMood: mockSetMood,
    recentMoods: ['light', 'dark'],
  }),
}));

vi.mock('./contexts/EqContext', () => ({
  useEq: () => ({
    gains: [0, 0, 0, 0, 0, 0],
    presetName: 'Flat',
    setPreset: mockSetPreset,
    setBandGain: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: mockI18n }),
}));

describe('App', () => {
  beforeEach(() => {
    mockApi.originalFile = null;
    mockApi.processedBuffer = null;
    mockApi.originalBuffer = null;
    mockApi.duration = 0;
    mockState.error = null;
    mockState.isLoading = false;
    mockState.isProcessing = false;
    mockState.isPlaying = false;
    mockState.progress = 0;
    vi.clearAllMocks();
    document.head.innerHTML = '';
    document.title = '';
    mockI18n.language = 'en';
  });

  it('renders layout and updates meta tags', () => {
    renderWithRouter(<App />);

    expect(screen.getByText('app.title')).toBeInTheDocument();
    expect(document.title).toBe('meta.title');
    expect(document.documentElement.lang).toBe('en');
    expect(document.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('meta.description');
  });

  it('shows error message when present', () => {
    mockState.error = 'Oops';
    renderWithRouter(<App />);

    expect(screen.getByText('Oops')).toBeInTheDocument();
  });

  it('applies effects live, plays, and resets', async () => {
    mockApi.originalFile = new File(['123'], 'song.mp3', { type: 'audio/mp3' });
    mockApi.originalBuffer = new AudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: 44100 });
    mockApi.duration = 1.5;
    renderWithRouter(<App />);

    // Selecting a mode applies effects immediately (no separate "apply" step).
    await userEvent.click(screen.getByText('effects.8dAudio'));
    expect(mockApi.setEffects).toHaveBeenLastCalledWith({
      speedMultiplier: 1,
      reverbAmount: 0,
      audio8D: true,
      rotationSpeed: 0.4,
      bassBoost: false,
      bassBoostIntensity: undefined,
      bassUnderwater: undefined,
      // Nightcore beat fields ride along on every options payload; off outside Speed Up.
      enableBeats: false,
      beatsVolume: undefined,
    });

    await userEvent.click(screen.getByLabelText('playback.play'));
    expect(mockApi.playAudio).toHaveBeenCalledWith(mockApi.originalBuffer, 0);

    const resetButtons = screen.getAllByLabelText('accessibility.resetApp');
    await userEvent.click(resetButtons[0]);
    expect(mockApi.reset).toHaveBeenCalled();
  });

  it('loads a replacement file from the workspace', async () => {
    const file = new File(['abc'], 'upload.mp3', { type: 'audio/mp3' });
    mockApi.originalFile = file;

    renderWithRouter(<App />);

    await userEvent.upload(screen.getByLabelText('upload.browse'), file);
    expect(mockApi.loadAudioFile).toHaveBeenCalledWith(file);
  });

  it('shows loading progress message', () => {
    mockState.isLoading = true;
    mockState.progress = 50;
    renderWithRouter(<App />);

    expect(screen.getByText('upload.loading')).toBeInTheDocument();
  });

  it('exports successfully', async () => {
    mockApi.processedBuffer = new AudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: 44100 });
    renderWithRouter(<App />);

    await userEvent.click(screen.getByText('playback.export'));

    expect(mockApi.exportProcessedAudio).toHaveBeenCalled();
  });

  it('handles export errors gracefully', async () => {
    mockApi.processedBuffer = new AudioBuffer({ length: 1, numberOfChannels: 1, sampleRate: 44100 });
    mockApi.exportProcessedAudio.mockRejectedValueOnce(new Error('fail'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    renderWithRouter(<App />);

    await userEvent.click(screen.getByText('playback.export'));
    expect(mockApi.exportProcessedAudio).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it('applies an equalizer preset from the settings menu', async () => {
    renderWithRouter(<App />);
    // The settings menu now hosts the listening EQ + language (moods moved to the rail).
    await userEvent.click(screen.getByLabelText('settings.open'));
    await userEvent.click(screen.getByRole('combobox', { name: 'settings.eqPreset' }));
    await userEvent.click(screen.getByRole('option', { name: 'Rock' }));
    expect(mockSetPreset).toHaveBeenCalledWith('Rock');
  });

  it('renders waveform timeline and allows seeking', async () => {
    mockApi.originalFile = new File(['123'], 'song.mp3', { type: 'audio/mp3' });
    mockApi.originalBuffer = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 });
    mockApi.duration = 2.5;

    renderWithRouter(<App />);

    const timeline = screen.getByTestId('waveform-timeline');
    timeline.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerDown(timeline, { clientX: 100 });

    expect(mockApi.seekTo).toHaveBeenCalled();
  });

  it('defers the waveform seek to drag-end (pointermove does not seek)', () => {
    mockApi.originalFile = new File(['123'], 'song.mp3', { type: 'audio/mp3' });
    mockApi.originalBuffer = new AudioBuffer({ length: 44100, numberOfChannels: 1, sampleRate: 44100 });
    mockApi.duration = 2.5;

    renderWithRouter(<App />);

    const timeline = screen.getByTestId('waveform-timeline');
    timeline.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 200, bottom: 100, width: 200, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

    // Press seeks immediately (click-to-seek preserved).
    fireEvent.pointerDown(timeline, { clientX: 50 });
    expect(mockApi.seekTo).toHaveBeenCalledTimes(1);

    // Dragging only moves the playhead visually - no extra seeks (graph rebuilds) mid-drag.
    fireEvent.pointerMove(timeline, { clientX: 120 });
    fireEvent.pointerMove(timeline, { clientX: 160 });
    expect(mockApi.seekTo).toHaveBeenCalledTimes(1);

    // Drag-end commits the final position once.
    fireEvent.pointerUp(timeline, { clientX: 160 });
    expect(mockApi.seekTo).toHaveBeenCalledTimes(2);
  });
});
