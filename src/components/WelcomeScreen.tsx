import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, Waves, Radio, Volume2, ShieldCheck } from 'lucide-react';
import { FileUploader } from './FileUploader';
import { ProgressBar } from './ProgressBar';
import { SettingsMenu } from './SettingsMenu';
import { AmbientScene } from './AmbientScene';
import { MoodTransition } from './MoodTransition';
import { OverlayScrollbar } from './OverlayScrollbar';
import { Logo } from './Logo';
import { Badge } from './ui/badge';
import { SHELL_CLASS } from './shell';

interface WelcomeScreenProps {
  onFileSelect: (file: File) => void;
  isLoading: boolean;
  progress: number;
  /** Remount key for the uploader; bumped on reset to clear its internal state. */
  uploadRevision: number;
  /** Shared error banner node (also rendered by the workspace stage). */
  errorBanner: ReactNode;
}

/**
 * The welcome/landing stage: brand mark, pitch, uploader (or loading progress),
 * effect badges and the privacy promise, all floating over the ambient scene.
 * Rendered while no session is loaded; the workspace stage takes over after.
 */
export function WelcomeScreen({
  onFileSelect,
  isLoading,
  progress,
  uploadRevision,
  errorBanner,
}: WelcomeScreenProps) {
  const { t } = useTranslation();
  const welcomeShellRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={welcomeShellRef} className={SHELL_CLASS}>
      <OverlayScrollbar target={welcomeShellRef} insetTop={24} insetBottom={24} />
      <AmbientScene />
      <MoodTransition />
      {/* Sticky so the settings entry point stays reachable while the landing
         scrolls; pointer-events gymnastics keep the full-width row from
         swallowing clicks on content sliding underneath it. */}
      <div className="sticky top-0 z-40 flex items-center justify-end gap-2 px-4 sm:px-6 py-4 pointer-events-none [&>*]:pointer-events-auto">
        <SettingsMenu />
      </div>

      <main className="flex-1 flex items-center justify-center px-4 sm:px-6 pb-16">
        <div className="aurora-stage relative w-full max-w-2xl flex flex-col items-center text-center">
          <Logo className="w-16 h-16 rounded-[18px] shadow-[0_18px_50px_-24px_rgba(var(--aurora-pink),0.7)] mb-7" />
          <h1 className="font-display lowercase text-5xl sm:text-6xl font-light tracking-[0.04em] text-[rgb(var(--color-text))]">
            {t('app.title')}
          </h1>
          <p className="font-display mt-4 text-lg sm:text-xl font-light text-balance text-[rgba(var(--color-text),0.88)] max-w-md">
            {t('app.subtitle')}
          </p>

          <div className="w-full mt-10 space-y-4">
            {errorBanner}
            {isLoading ? (
              <ProgressBar
                progress={progress}
                isProcessing={isLoading}
                message={t('upload.loading')}
              />
            ) : (
              <FileUploader
                key={uploadRevision}
                onFileSelect={onFileSelect}
                isLoading={isLoading}
                hasFile={false}
              />
            )}
          </div>

          <ul className="mt-10 flex flex-wrap items-center justify-center gap-3">
            {[
              { icon: Zap, label: t('effects.speedUp') },
              { icon: Waves, label: t('effects.slowReverb') },
              { icon: Radio, label: t('effects.8dAudio') },
              { icon: Volume2, label: t('effects.bassBoost') },
            ].map(({ icon: Icon, label }) => (
              <li key={label}>
                <Badge variant="hud" className="gap-2">
                  <Icon className="w-4 h-4 text-[rgb(var(--color-accent-text))]" aria-hidden="true" />
                  {label}
                </Badge>
              </li>
            ))}
          </ul>

          {/* The privacy promise is a design principle, not a footnote - the
             accent-lit shield and near-full ink keep it legible over the scene. */}
          <p className="mt-8 flex items-center gap-2 text-xs font-medium text-[rgba(var(--color-text),0.82)]">
            <ShieldCheck className="w-4 h-4 text-[rgb(var(--color-accent-text))]" aria-hidden="true" />
            {t('features.private.desc')}
          </p>
        </div>
      </main>

      <footer className="pb-8 text-center">
        <p className="text-xs text-[rgba(var(--color-text),0.72)]">{t('footer.built')}</p>
      </footer>
    </div>
  );
}
