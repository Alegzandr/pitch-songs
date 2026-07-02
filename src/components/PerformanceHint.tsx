import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, X } from 'lucide-react';
import { detectGpuTier } from './scenes/webgl/gpu';

const DISMISS_KEY = 'reverie:gpu-hint-dismissed';

/**
 * Discreet, once-only nudge shown when the browser is rendering Reverie in
 * software (hardware acceleration off / GPU blocklisted). It does two things:
 *
 *  1. Auto-degrade - flags `<html>` with `.gpu-software`, which the stylesheet
 *     uses to drop the most expensive backdrop layers (blur, particles, meteors,
 *     haze animation) so the cockpit stays fluid even on the CPU rasterizer. This
 *     happens regardless of whether the hint is dismissed.
 *  2. Suggest - a quiet pill inviting the user to re-enable hardware acceleration
 *     (which the page itself can't toggle - it's a browser setting). Dismissed
 *     once, it never returns (remembered in localStorage).
 *
 * On hardware (or when WebGL is simply unavailable, which could be a privacy
 * blocker rather than a slow GPU) it renders nothing and touches nothing.
 */
export function PerformanceHint() {
  const { t } = useTranslation();
  const [tier] = useState(detectGpuTier);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  // Drives the entrance fade so the pill eases in rather than snapping.
  const [shown, setShown] = useState(false);

  const isSoftware = tier === 'software';

  useEffect(() => {
    if (!isSoftware) return;
    document.documentElement.classList.add('gpu-software');
    return () => document.documentElement.classList.remove('gpu-software');
  }, [isSoftware]);

  useEffect(() => {
    if (!isSoftware || dismissed) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [isSoftware, dismissed]);

  if (!isSoftware || dismissed) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* private mode - the hint just won't persist its dismissal */
    }
    setDismissed(true);
  };

  return (
    <div
      role="status"
      className={`fixed bottom-4 left-4 z-50 max-w-xs transition-[opacity,transform] duration-500 ease-out ${
        shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
      }`}
    >
      <div className="flex items-start gap-3 rounded-2xl border border-[rgba(var(--hud-line),0.45)] bg-[rgba(var(--color-surface),0.85)] px-4 py-3 shadow-[0_18px_50px_-26px_rgba(var(--hud-glow),0.7)] backdrop-blur-xl">
        <Zap className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--color-accent-text))]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[rgb(var(--color-text))]">
            {t('performance.title')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[rgb(var(--color-text-secondary))]">
            {t('performance.body')}
          </p>
        </div>
        <button
          onClick={dismiss}
          aria-label={t('performance.dismiss')}
          className="ios-button -mr-1 -mt-1 shrink-0 cursor-pointer rounded-full p-1 text-[rgb(var(--color-text-secondary))] outline-none hover:text-[rgb(var(--color-text))] focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
