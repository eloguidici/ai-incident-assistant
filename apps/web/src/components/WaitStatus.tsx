import type { ReactNode } from 'react';

/**
 * Shows one in-progress line while a request is open. The message is the accessible status text.
 * @param children The existing wait message. It is not rewritten.
 * @returns A status region with an indeterminate bar.
 */
export function WaitStatus({ children }: { children: ReactNode }) {
  return (
    <p className="wait" role="status">
      <span className="wait-bar" aria-hidden="true" />
      {children}
    </p>
  );
}
