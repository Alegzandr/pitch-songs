import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A scroll region that dissolves its content at whichever edge still hides more.
 *
 * The overlay scrollbar fades out when idle, so on a resting panel there is no
 * cue that it can scroll at all. This masks the top/bottom edge instead: the
 * fade grows from 0 to FADE as you pull away from an edge (and shrinks back as
 * you reach it), so "there is more below/above" reads at a glance without a
 * permanent bar. No fade appears when the content fits.
 *
 * The mask is driven by two CSS vars set from the live scroll geometry; the
 * gradient itself lives in `.scroll-fade` (index.css).
 */

/** Soft edge (px) at full strength - the depth of the dissolve at an open edge. */
const FADE = 28;

export function ScrollFade({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const distBottom = scrollHeight - clientHeight - scrollTop;
      // Ramp with distance so the dissolve eases in as you scroll off an edge.
      el.style.setProperty('--fade-t', `${Math.min(Math.max(scrollTop, 0), FADE)}px`);
      el.style.setProperty('--fade-b', `${Math.min(Math.max(distBottom, 0), FADE)}px`);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // scrollHeight tracks the content, but the observer only reports a box's own
    // size - so watch the children too (an effect mode expanding, a track loading).
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((child) => ro.observe(child));
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={`scroll-fade${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
