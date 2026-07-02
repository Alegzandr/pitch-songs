import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

// Calm, constant scroll speed (px/s) so long and short titles travel at the same
// pace, and the gap between the two looping copies.
const SPEED_PX_PER_S = 36;
const GAP_PX = 48;

interface MarqueeTextProps {
  text: string;
  /** Styling for the text itself (font, size, weight, colour). */
  className?: string;
}

/**
 * Single-line text that gently scrolls (a seamless marquee) only when it would
 * otherwise be clipped; text that fits sits static. The loop is seamless (two
 * copies + a gap), the speed is constant in px/s whatever the length, and it
 * falls back to a static ellipsis under prefers-reduced-motion. When the text is
 * clipped, hovering reveals the full string through the shared (glass) Tooltip; it
 * also stays available to assistive tech via the rendered copy.
 */
export const MarqueeText = memo(function MarqueeText({ text, className }: MarqueeTextProps) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [overflow, setOverflow] = useState(false);
  const [reduce, setReduce] = useState(false);

  const measure = useCallback(() => {
    const container = containerRef.current;
    const measurer = measureRef.current;
    if (!container || !measurer) return;
    const tw = measurer.scrollWidth;
    setTextWidth(tw);
    // +1 guards against sub-pixel rounding triggering a needless scroll.
    setOverflow(tw > container.clientWidth + 1);
  }, []);

  useLayoutEffect(() => {
    measure();
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    // The brand fonts load async; fallback metrics differ, so re-measure once
    // they settle to avoid a wrong overflow verdict on first paint.
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(measure).catch(() => {});
    }
    return () => ro.disconnect();
  }, [measure, text]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const animate = overflow && !reduce;
  const duration = (textWidth + GAP_PX) / SPEED_PX_PER_S;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span ref={containerRef} className={cn('marquee', animate && 'marquee-fade')}>
          {/* Off-layout measurer - intrinsic text width, independent of scroll state. */}
          <span ref={measureRef} className={cn('marquee-measure', className)} aria-hidden="true">
            {text}
          </span>

          {animate ? (
            <span className="marquee-track" style={{ animationDuration: `${duration}s` }}>
              <span className={cn('marquee-item', className)}>{text}</span>
              <span className={cn('marquee-item', className)} aria-hidden="true">
                {text}
              </span>
            </span>
          ) : (
            <span className={cn('block truncate', className)}>{text}</span>
          )}
        </span>
      </TooltipTrigger>
      {/* Only offer the tooltip when the title is actually clipped - a fully visible
          name needs no redundant pill. */}
      {overflow && <TooltipContent>{text}</TooltipContent>}
    </Tooltip>
  );
});
