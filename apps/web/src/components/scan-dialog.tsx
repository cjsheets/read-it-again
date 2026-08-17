import { useEffect, useRef, useState } from 'react';
import type { IsbnMatch } from '@read-it-again/storage-schema';
import { useApp } from '../app-state.js';
import { createScanner, type ScannerKind } from '../scanner.js';

/** How often a frame is handed to the decoder. Every frame would pin a phone CPU
 *  for no benefit: a hand holding a book steady still gives several chances a
 *  second, and the decoder is the expensive part. */
const FRAME_INTERVAL_MS = 250;

type Phase =
  | { readonly step: 'starting' }
  | { readonly step: 'scanning'; readonly kind: ScannerKind }
  | { readonly step: 'known'; readonly isbn: string; readonly match: IsbnMatch }
  | { readonly step: 'failed'; readonly reason: string };

/**
 * Audit §8.5, kept to the scope the audit sets for a first version: point the
 * camera at a barcode, decode EAN-13, and ask the *local* database about it.
 * There is no catalog lookup here — the browser has none (ADR 0002) — so a book
 * this household has never seen resolves to an ISBN and nothing else, and the
 * person still has to say what it is called.
 *
 * Everything this does is also reachable by typing, which matters more than the
 * camera does: scanning is a shortcut for people holding a stack of books, not a
 * route anyone is required to take.
 */
export function ScanDialog({
  onIsbn,
  onShowShelf,
  onClose,
}: {
  /** A scanned ISBN that is not on the shelf yet. The caller decides what to do
   *  with it; this dialog never writes anything. */
  readonly onIsbn: (isbn: string) => void;
  readonly onShowShelf: (title: string) => void;
  readonly onClose: () => void;
}) {
  const { lookupIsbn } = useApp();
  const [phase, setPhase] = useState<Phase>({ step: 'starting' });
  const video = useRef<HTMLVideoElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // Read inside the effect's loop, which outlives any single render.
  const handlers = useRef({ onIsbn, lookupIsbn });
  handlers.current = { onIsbn, lookupIsbn };

  useEffect(() => {
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const stop = () => {
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      for (const track of stream?.getTracks() ?? []) track.stop();
    };

    void (async () => {
      try {
        // The rear camera is the one pointing at the book. `ideal` rather than
        // `exact` so a laptop with only a front camera still works.
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
        });
        const scanner = await createScanner();
        if (stopped) {
          stop();
          return;
        }
        const element = video.current;
        if (!element) return;
        element.srcObject = stream;
        await element.play();
        setPhase({ step: 'scanning', kind: scanner.kind });

        const tick = async () => {
          if (stopped || !video.current) return;
          let isbn: string | null = null;
          try {
            isbn = await scanner.read(video.current);
          } catch {
            // One unreadable frame is not a failure worth reporting; most frames
            // in a live preview have nothing in them.
          }
          if (stopped) return;
          if (isbn) {
            const match = await handlers.current.lookupIsbn(isbn);
            if (stopped) return;
            stop();
            if (match) setPhase({ step: 'known', isbn, match });
            else handlers.current.onIsbn(isbn);
            return;
          }
          timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
        };
        timer = setTimeout(() => void tick(), FRAME_INTERVAL_MS);
      } catch (caught) {
        stop();
        setPhase({ step: 'failed', reason: describe(caught) });
      }
    })();

    return stop;
  }, []);

  return (
    <div className="detail-scrim" role="presentation" onClick={onClose}>
      <div
        className="detail scan-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Scan a barcode"
        data-testid="scan-dialog"
        ref={panel}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="detail-header">
          <h3>Scan a barcode</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>

        {/* Kept mounted across phases: tearing the element down and rebuilding it
            makes the preview flicker every time the status line changes. */}
        <video
          className={phase.step === 'scanning' ? 'scan-preview' : 'scan-preview is-hidden'}
          data-testid="scan-preview"
          ref={video}
          muted
          playsInline
        />

        <p aria-live="polite" data-testid="scan-status">
          {phase.step === 'starting' && 'Starting the camera…'}
          {phase.step === 'scanning' && 'Point the camera at the barcode on the back of the book.'}
          {phase.step === 'known' && `You already have this: ${phase.match.title}.`}
          {phase.step === 'failed' && phase.reason}
        </p>

        {phase.step === 'known' && (
          <button
            type="button"
            className="primary"
            data-testid="scan-show-on-shelf"
            onClick={() => onShowShelf(phase.match.title)}
          >
            Show it on the shelf
          </button>
        )}

        {phase.step === 'failed' && (
          <p className="model-note">
            You can always type the ISBN in instead — it is the field just below this button.
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Camera failures are mostly one of two things, and the difference decides what
 * the person should do next: a refused permission is fixable in the browser, and
 * an absent camera is not fixable at all.
 */
function describe(caught: unknown): string {
  const name = caught instanceof Error ? caught.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'This browser is not allowing camera access. Allow it in the address bar, or type the ISBN in instead.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera was found on this device. Type the ISBN in instead.';
  }
  return caught instanceof Error ? caught.message : 'The camera could not be started.';
}
