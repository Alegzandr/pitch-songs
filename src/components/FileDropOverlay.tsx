import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { AuroraOrb } from './AuroraOrb';
import { FILE_FORMATS } from '../constants';

interface FileDropOverlayProps {
  onFileSelect: (file: File) => void;
  /** When true, drops are ignored (e.g. while a track is decoding/exporting). */
  disabled?: boolean;
}

/**
 * Window-wide drop target for swapping the current track. Unlike the compact
 * FileUploader (a single button), this lets the user drop an audio file
 * anywhere over the workspace. It listens on `window` and only reveals its
 * overlay when files are actually being dragged in - so it never gets in the
 * way of ordinary pointer use.
 */
export const FileDropOverlay = memo(function FileDropOverlay({ onFileSelect, disabled }: FileDropOverlayProps) {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  // dragenter/dragleave fire for every nested element the cursor crosses, so a
  // single boolean flickers. Counting enters minus leaves tracks the window as
  // one region and only drops to zero when the drag truly leaves the page.
  const dragDepth = useRef(0);

  // Whether a drag carries files (vs. selected text, a link, etc.).
  const hasFiles = (e: DragEvent) =>
    Array.from(e.dataTransfer?.types ?? []).includes('Files');

  const reset = useCallback(() => {
    dragDepth.current = 0;
    setIsDragging(false);
  }, []);

  useEffect(() => {
    // While disabled (e.g. exporting) we skip attaching listeners; the overlay
    // is also hidden by the render guard below, so an in-flight drag can't
    // reveal it. A drag can't realistically begin during an export anyway.
    if (disabled) return;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current += 1;
      setIsDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      // Required for the drop event to fire at all.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setIsDragging(false);
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      reset();
      const file = e.dataTransfer?.files[0];
      const mime = file?.type as (typeof FILE_FORMATS.ACCEPTED_MIME_TYPES)[number];
      if (file && FILE_FORMATS.ACCEPTED_MIME_TYPES.includes(mime)) {
        onFileSelect(file);
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [disabled, onFileSelect, reset]);

  if (!isDragging || disabled) return null;

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center p-6 pointer-events-none animate-in fade-in duration-150"
      role="presentation"
    >
      <div className="absolute inset-0 bg-[rgba(var(--color-background),0.72)] backdrop-blur-md" />
      <div className="relative flex flex-col items-center gap-5 rounded-[28px] border-2 border-dashed border-[rgb(var(--color-accent))] bg-[rgba(var(--color-surface),0.6)] px-12 py-14 text-center shadow-[0_30px_80px_-30px_rgba(var(--aurora-pink),0.7)]">
        <AuroraOrb
          className="grid place-items-center shadow-[0_0_0_4px_rgba(var(--aurora-pink),0.18)]"
          icon={<Upload className="h-6 w-6 text-[rgb(var(--aurora-violet))]" aria-hidden="true" />}
        />
        <p className="text-xl font-semibold text-[rgb(var(--color-text))]">
          {t('upload.dropToReplace')}
        </p>
        <p className="text-xs uppercase tracking-wide text-[rgb(var(--color-text-secondary))]">
          {t('upload.formats')}
        </p>
      </div>
    </div>
  );
});
