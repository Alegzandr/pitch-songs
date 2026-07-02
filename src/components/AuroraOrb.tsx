import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AuroraOrbProps {
  /** Icon rendered inside the dark well (pass any sizing/hover classes on it). */
  icon: ReactNode;
  /** Extra classes for the gradient ring (positioning, shadows, transitions). */
  className?: string;
  /** Wrap the orb in the `.upload-echo` concentric reverberation rings. */
  withEcho?: boolean;
  /** Extra classes for the echo wrapper (e.g. bottom margin). Only used with `withEcho`. */
  echoWrapperClassName?: string;
}

/**
 * The brand's "aurora orb": an aurora gradient stroked around a dark glass
 * well holding an icon. Aurora as a stroke, not a solid fill - it reads as the
 * brand without competing with the play orb, and steps away from the
 * gradient-square upload cliché. With `withEcho`, the orb sits inside the
 * reverb motif's breathing echo arcs (the mark's echo arcs, the play orb's
 * pulse).
 */
export function AuroraOrb({ icon, className, withEcho, echoWrapperClassName }: AuroraOrbProps) {
  const orb = (
    <span
      className={cn(
        'h-16 w-16 rounded-full p-[2px]',
        'bg-[linear-gradient(135deg,rgb(var(--aurora-violet)),rgb(var(--aurora-pink))_55%,rgb(var(--aurora-cyan)))]',
        className
      )}
    >
      <span className="flex h-full w-full items-center justify-center rounded-full bg-[rgb(var(--color-surface))]">
        {icon}
      </span>
    </span>
  );

  if (!withEcho) return orb;

  return (
    <div className={cn('relative grid place-items-center', echoWrapperClassName)} aria-hidden="true">
      <span className="upload-echo absolute h-[4.75rem] w-[4.75rem] rounded-full border border-[rgba(var(--aurora-violet),0.4)]" />
      <span
        className="upload-echo absolute h-[6.25rem] w-[6.25rem] rounded-full border border-[rgba(var(--aurora-pink),0.3)]"
        style={{ animationDelay: '1.6s' }}
      />
      {orb}
    </div>
  );
}
