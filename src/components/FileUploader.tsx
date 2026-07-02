import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AuroraOrb } from './AuroraOrb';
import { FILE_FORMATS } from '../constants';

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  isLoading?: boolean;
  hasFile?: boolean;
}

// Memoised: all three props are stable between interactions (the callback comes
// from a useCallback in App), so it only re-renders when they actually change.
export const FileUploader = memo(function FileUploader({ onFileSelect, isLoading, hasFile }: FileUploaderProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  // Opening the native file picker forces the browser out of fullscreen. On
  // selection the `change` handler restores it directly. But cancelling the
  // picker fires no event, and re-entering fullscreen requires a transient user
  // activation the browser won't grant from a focus/timer. So we arm the restore
  // on the user's next gesture (pointerdown/keydown) — the next moment a valid
  // activation exists — which covers both the cancel and the selection paths.
  const wasFullscreenRef = useRef(false);
  const disarmRef = useRef<(() => void) | null>(null);

  const restoreFullscreen = useCallback(() => {
    disarmRef.current?.();
    disarmRef.current = null;
    if (!wasFullscreenRef.current) return;
    wasFullscreenRef.current = false;
    if (
      typeof document !== 'undefined' &&
      !document.fullscreenElement &&
      document.documentElement.requestFullscreen
    ) {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleInputClick = useCallback(() => {
    wasFullscreenRef.current =
      typeof document !== 'undefined' && Boolean(document.fullscreenElement);
    if (!wasFullscreenRef.current) return;
    // Runs on `click`, after the opening pointerdown/keydown have already fired,
    // so the next gesture we hear is the one that closes (or follows) the dialog.
    const onGesture = () => restoreFullscreen();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    disarmRef.current = () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [restoreFullscreen]);

  useEffect(() => () => disarmRef.current?.(), []);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      const mime = file?.type as typeof FILE_FORMATS.ACCEPTED_MIME_TYPES[number];
      if (file && FILE_FORMATS.ACCEPTED_MIME_TYPES.includes(mime)) {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        restoreFullscreen();
        onFileSelect(file);
        e.target.value = '';
      }
    },
    [onFileSelect, restoreFullscreen]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const input = (
    <input
      type="file"
      accept="audio/*"
      onClick={handleInputClick}
      onChange={handleFileInput}
      className="hidden"
      id="file-input"
      disabled={isLoading}
      aria-label={t('upload.browse')}
    />
  );

  // Compact variant - lives in the workspace chrome to swap the current track.
  // Drag-and-drop is handled window-wide by FileDropOverlay, so this is just the
  // browse button (no local drop handlers, which would double-fire onFileSelect).
  if (hasFile) {
    return (
      <div role="region" aria-label={t('upload.title')}>
        {input}
        <Button
          asChild
          variant="outline"
          size="sm"
          className={cn(isLoading && 'pointer-events-none opacity-50')}
        >
          <label htmlFor="file-input" className="cursor-pointer">
            <RefreshCw className="w-4 h-4 text-[rgb(var(--color-text-secondary))]" aria-hidden="true" />
            <span className="hidden sm:inline">{t('upload.browse')}</span>
          </label>
        </Button>
      </div>
    );
  }

  // Hero variant - the welcome stage's primary affordance.
  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className="relative w-full"
      role="region"
      aria-label={t('upload.title')}
    >
      {input}
      {/* The first surface a visitor ever touches wears the same holographic
         plate language as the cockpit panels (glass + hairline + lit corner
         brackets via .hud-frame) - the HUD identity starts here, not after
         upload. Drag feedback uses an outline + a tint overlay rather than
         fighting the glass plate's own border/shadow recipe. */}
      <label
        htmlFor="file-input"
        className={`
          group relative flex flex-col items-center justify-center text-center
          glass hud-frame rounded-3xl px-8 py-12 sm:py-14
          transition-colors duration-200
          ${isDragging ? '[outline:2px_solid_rgba(var(--color-accent),0.75)] [outline-offset:-2px]' : ''}
          ${isLoading ? 'opacity-50 cursor-not-allowed' : 'ios-button cursor-pointer'}
        `}
      >
        {isDragging && (
          <span
            className="pointer-events-none absolute inset-0 rounded-3xl bg-[rgba(var(--color-accent),0.08)]"
            aria-hidden="true"
          />
        )}
        <AuroraOrb
          withEcho
          echoWrapperClassName="mb-6"
          className={cn(
            'relative transition-transform duration-300 group-hover:scale-105',
            isDragging
              ? 'scale-105 shadow-[0_0_0_4px_rgba(var(--aurora-pink),0.18),0_22px_50px_-20px_rgba(var(--aurora-pink),0.9)]'
              : 'shadow-[0_18px_44px_-22px_rgba(var(--aurora-pink),0.75)]'
          )}
          icon={
            <Upload className="h-6 w-6 text-[rgb(var(--aurora-violet))] transition-transform duration-300 group-hover:-translate-y-0.5" />
          }
        />
        <p className="text-lg sm:text-xl font-semibold text-[rgb(var(--color-text))]">
          {t('upload.dragDrop')}
        </p>
        <p className="mt-2 text-sm text-[rgb(var(--color-text-secondary))]">
          {t('upload.or')}{' '}
          <span className="font-medium text-[rgb(var(--color-accent-text))] underline-offset-4 group-hover:underline">
            {t('upload.browse')}
          </span>
        </p>
        <p className="mt-5 text-xs uppercase tracking-wide text-[rgb(var(--color-text-secondary))]">
          {t('upload.formats')}
        </p>
      </label>
    </div>
  );
});
