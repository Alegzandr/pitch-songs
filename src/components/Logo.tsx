import { memo, useId } from 'react';

type LogoProps = {
  className?: string;
  /** Decorative by default; pass a label to expose it to assistive tech. */
  label?: string;
};

/**
 * Reverie's mark, inlined so it can breathe with the active mood. The night sky,
 * moon and stars stay moonlit, but the rippled reflection - Reverie's signature
 * "music as moonglade" - and the accent stars take on the mood's accent, so the
 * brand quietly recolours itself the moment a mood is selected.
 *
 * IDs are namespaced per instance (useId) so multiple logos on one page don't
 * collide on shared gradient/filter defs.
 */
// Memoised: a ~30-node SVG with per-instance gradient defs, worth skipping on
// every parent render its two string props don't change.
export const Logo = memo(function Logo({ className, label }: LogoProps) {
  const uid = useId();
  const id = (name: string) => `${name}-${uid}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        {/* Backdrop tracks the mood's deep tones (background → surface), so the
            whole tile harmonises with the active mood, not just the waves. */}
        <linearGradient id={id('bg')} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'rgb(var(--color-background))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--color-surface))' }} />
        </linearGradient>
        {/* Moon halo carries a soft wash of the mood accent. */}
        <radialGradient id={id('halo')} cx="0.5" cy="0.34" r="0.66">
          <stop offset="0" style={{ stopColor: 'rgb(var(--color-accent))' }} stopOpacity="0.4" />
          <stop offset="0.55" style={{ stopColor: 'rgb(var(--color-accent))' }} stopOpacity="0.18" />
          <stop offset="1" style={{ stopColor: 'rgb(var(--color-accent))' }} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('moon')} cx="0.4" cy="0.36" r="0.75">
          <stop offset="0" stopColor="#F2FBFF" />
          <stop offset="0.55" stopColor="#CDEBFF" />
          <stop offset="1" stopColor="#9FD3F2" />
        </radialGradient>
        {/* The aurora gradient is mood-bound: it drives the horizon and the
            rippled reflection, so the brand's "sound waves" wear the mood.
            NB: var() only resolves inside CSS, never in SVG presentation
            attributes - so the mood colours are set via `style`, not stop-color. */}
        <linearGradient id={id('aurora')} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: 'rgb(var(--color-accent-hover))' }} />
          <stop offset="0.5" style={{ stopColor: 'rgb(var(--color-accent))' }} />
          <stop offset="1" style={{ stopColor: 'rgb(var(--color-accent))' }} />
        </linearGradient>
        <filter id={id('soft')} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="2.2" />
        </filter>
      </defs>

      <rect x="3" y="3" width="94" height="94" rx="22" fill={`url(#${id('bg')})`} />
      <rect x="3" y="3" width="94" height="94" rx="22" fill={`url(#${id('halo')})`} />

      {/* moon glow + disc */}
      <circle cx="50" cy="36" r="15" fill="#BfE6FF" opacity="0.45" filter={`url(#${id('soft')})`} />
      <circle cx="50" cy="36" r="13.5" fill={`url(#${id('moon')})`} />

      {/* horizon */}
      <rect x="16" y="52.5" width="68" height="1.4" rx="0.7" fill={`url(#${id('aurora')})`} opacity="0.5" />

      {/* rippled reflection: the moonglade as reverberating sound waves */}
      <g fill="none" stroke={`url(#${id('aurora')})`} strokeLinecap="round">
        <path d="M37 59 Q43 57.5 50 59 T63 59" strokeWidth="2.6" opacity="0.9" />
        <path d="M40 65 Q45 63.6 50 65 T60 65" strokeWidth="2.4" opacity="0.7" />
        <path d="M42.5 71 Q46.5 69.8 50 71 T57.5 71" strokeWidth="2.2" opacity="0.52" />
        <path d="M44.5 77 Q47.5 76 50 77 T55.5 77" strokeWidth="2" opacity="0.36" />
        <path d="M46.5 82.5 Q48.5 81.8 50 82.5 T53.5 82.5" strokeWidth="1.8" opacity="0.24" />
      </g>

      {/* a few stars in the night sky - two pick up the mood accent (via style,
          since var() doesn't resolve in the `fill` presentation attribute) */}
      <circle cx="27" cy="25" r="1.5" fill="#CDEBFF" opacity="0.9" />
      <circle cx="73" cy="22" r="1.7" style={{ fill: 'rgb(var(--color-accent-hover))' }} opacity="0.85" />
      <circle cx="68" cy="44" r="1.2" style={{ fill: 'rgb(var(--color-accent))' }} opacity="0.8" />
      <circle cx="31" cy="43" r="1.1" fill="#CDEBFF" opacity="0.7" />
    </svg>
  );
});
