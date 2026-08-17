import { booklandIsbn } from '@read-it-again/domain';
// Self-hosted on purpose. zxing-wasm defaults to fetching its binary from a CDN,
// which `connect-src 'self'` forbids outright and which would make the feature
// fail on exactly the trip to the library where there is no signal. Vite emits
// this under /assets/, so it is same-origin, and the service worker's crawler
// picks the URL up out of the bundle and precaches it (audit §8.1).
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/**
 * How this device can read a barcode.
 *
 * `native` is the platform's own detector, which costs nothing to load. It is
 * absent on iOS Safari, Firefox, and desktop Chromium, so it is a fast path and
 * never a requirement — and it is only taken when `getSupportedFormats()`
 * actually names EAN-13, because a detector that exists but cannot read book
 * barcodes is worse than no detector at all.
 *
 * `wasm` is the self-hosted decoder, which every browser with a camera can run.
 * `unavailable` means there is no camera to point at anything.
 */
export type ScannerKind = 'native' | 'wasm' | 'unavailable';

/** ISBN barcodes are Bookland EAN-13. Nothing else on a book jacket is one. */
const NATIVE_FORMAT = 'ean_13';
const ZXING_FORMAT = 'EAN-13';

interface NativeDetector {
  detect(source: CanvasImageSource): Promise<readonly { rawValue: string }[]>;
}

interface NativeDetectorConstructor {
  new (options: { formats: readonly string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<readonly string[]>;
}

function nativeConstructor(): NativeDetectorConstructor | undefined {
  return (globalThis as { BarcodeDetector?: NativeDetectorConstructor }).BarcodeDetector;
}

/** Whether this browser can offer camera capture at all. Cheap and synchronous,
 *  so it can gate whether the button is even rendered. */
export function cameraSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

export async function detectScannerKind(): Promise<ScannerKind> {
  if (!cameraSupported()) return 'unavailable';
  const Detector = nativeConstructor();
  if (Detector?.getSupportedFormats) {
    try {
      const formats = await Detector.getSupportedFormats();
      if (formats.includes(NATIVE_FORMAT)) return 'native';
    } catch {
      // A detector that throws while being asked what it supports is not one to
      // rely on. Fall through to the decoder we ship ourselves.
    }
  }
  return 'wasm';
}

export interface Scanner {
  readonly kind: ScannerKind;
  /** The ISBN visible in this frame, or null. Never throws for an unreadable
   *  frame: most frames in a live preview are unreadable, and that is normal. */
  read(frame: HTMLVideoElement): Promise<string | null>;
}

/**
 * Loads whichever decoder this browser needs. The wasm binary is fetched here
 * rather than at startup, so a household that never opens the scanner never pays
 * for it beyond the precache.
 */
export async function createScanner(): Promise<Scanner> {
  const kind = await detectScannerKind();
  if (kind === 'unavailable') throw new Error('This device has no camera to scan with.');
  if (kind === 'native') {
    const Detector = nativeConstructor();
    if (!Detector) throw new Error('This browser cannot read barcodes.');
    const detector = new Detector({ formats: [NATIVE_FORMAT] });
    return {
      kind,
      read: async (frame) => {
        const found = await detector.detect(frame);
        return firstIsbn(found.map((barcode) => barcode.rawValue));
      },
    };
  }

  const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
  await prepareZXingModule({
    overrides: {
      locateFile: (path: string, prefix: string) =>
        path.endsWith('.wasm') ? wasmUrl : prefix + path,
    },
    fireImmediately: true,
  });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('This browser cannot read frames from the camera.');
  return {
    kind,
    read: async (frame) => {
      const width = frame.videoWidth;
      const height = frame.videoHeight;
      if (width === 0 || height === 0) return null;
      canvas.width = width;
      canvas.height = height;
      context.drawImage(frame, 0, 0, width, height);
      const results = await readBarcodes(context.getImageData(0, 0, width, height), {
        formats: [ZXING_FORMAT],
        // A barcode held by someone pointing a phone one-handed is rarely square
        // to the camera, and a scan that needs three attempts feels broken.
        tryHarder: true,
        tryRotate: true,
        tryInvert: true,
        maxNumberOfSymbols: 1,
      });
      return firstIsbn(results.filter((result) => result.isValid).map((result) => result.text));
    },
  };
}

/** The first candidate that is a book rather than any other barcoded object. */
function firstIsbn(candidates: readonly string[]): string | null {
  for (const candidate of candidates) {
    const isbn = booklandIsbn(candidate);
    if (isbn) return isbn;
  }
  return null;
}
