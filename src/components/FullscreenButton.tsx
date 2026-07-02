import { memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize, Minimize } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

/**
 * Toggles browser fullscreen on the document root. Mirrors the native state via
 * the `fullscreenchange` event so the icon and label stay correct even when the
 * user leaves fullscreen with the Esc key or the browser chrome.
 */
// Memoised: prop-less chrome - its state is entirely internal (fullscreenchange).
export const FullscreenButton = memo(function FullscreenButton() {
  const { t } = useTranslation();
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement),
  );

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen().catch(() => {});
    }
  }, []);

  // Fullscreen is unsupported in some embedded/iframe contexts; hide rather than
  // offer a button that silently does nothing.
  if (typeof document !== 'undefined' && !document.documentElement.requestFullscreen) {
    return null;
  }

  const label = isFullscreen
    ? t('accessibility.exitFullscreen')
    : t('accessibility.enterFullscreen');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" variant="glass" size="icon" aria-label={label} onClick={toggle}>
          {isFullscreen ? (
            <Minimize className="w-5 h-5 text-[rgb(var(--color-text))]" aria-hidden="true" />
          ) : (
            <Maximize className="w-5 h-5 text-[rgb(var(--color-text))]" aria-hidden="true" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});
