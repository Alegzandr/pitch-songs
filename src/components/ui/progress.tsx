import * as React from 'react';

import { cn } from '@/lib/utils';

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
}

/**
 * Slim track with an Aurora-gradient fill. Determinate only - the audio pipeline
 * always reports a real percentage, so there's no indeterminate state to model.
 */
const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, ...props }, ref) => (
    <div
      ref={ref}
      role="progressbar"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        'w-full h-1.5 bg-[rgba(var(--color-border),0.55)] rounded-full overflow-hidden',
        className
      )}
      {...props}
    >
      <div
        className="h-full bg-[linear-gradient(90deg,rgba(var(--aurora-violet),1),rgba(var(--aurora-pink),0.95),rgba(var(--aurora-cyan),0.9))] transition-[width] duration-300 ease-out rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  )
);
Progress.displayName = 'Progress';

export { Progress };
