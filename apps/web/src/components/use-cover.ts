import { useEffect, useState } from 'react';
import { requestWorker } from '../client.js';

export interface CoverBytes {
  readonly bytes: Uint8Array;
  readonly mime: string;
}

/**
 * Fetches stored cover bytes for one work, and only when the shelf says there are
 * any. Skipping the request entirely for the common case — a household that has
 * not set a cover — is what keeps a shelf of generated covers free of worker
 * traffic (ADR 0013).
 */
export function useCover(workId: string, hasCover: boolean): CoverBytes | undefined {
  const [cover, setCover] = useState<CoverBytes | undefined>(undefined);

  useEffect(() => {
    if (!hasCover) {
      setCover(undefined);
      return;
    }
    let cancelled = false;
    void requestWorker({ type: 'getCover', workId }).then((response) => {
      if (cancelled) return;
      setCover(response.ok && response.cover ? response.cover : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [workId, hasCover]);

  return cover;
}
