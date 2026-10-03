import { useEffect, useState } from 'react';
import { api } from '../api';

export type ContentLimits = { sourceTextMax: number; questionMax: number; contentProtectionEnabled: boolean; personProtectionEnabled: boolean };

/** @returns Authenticated runtime limits, or a closed loading/error state. Never substitutes a guessed maximum. */
export function useContentLimits() {
  const [limits, setLimits] = useState<ContentLimits | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<ContentLimits>('/api/analyses/limits', { signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        if (!Number.isInteger(value?.sourceTextMax) || value.sourceTextMax < 20 || value.sourceTextMax > 50000 ||
          !Number.isInteger(value?.questionMax) || value.questionMax < 1 || value.questionMax > 8000 ||
          typeof value.contentProtectionEnabled !== 'boolean' || typeof value.personProtectionEnabled !== 'boolean') throw new Error();
        setLimits({ sourceTextMax: value.sourceTextMax, questionMax: value.questionMax,
          contentProtectionEnabled: value.contentProtectionEnabled, personProtectionEnabled: value.personProtectionEnabled });
      })
      .catch(() => {
        if (!controller.signal.aborted) setError('Content limits could not be loaded. Reload the page to retry.');
      });
    return () => controller.abort();
  }, []);
  return { limits, error };
}
