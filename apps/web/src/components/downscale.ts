import { MAX_COVER_BYTES, MAX_COVER_HEIGHT, MAX_COVER_WIDTH } from '@read-it-again/storage-schema';

export interface DownscaledCover {
  readonly bytes: Uint8Array;
  readonly mime: string;
  readonly width: number;
  readonly height: number;
}

/**
 * Fits a chosen image inside the ADR 0013 caps before it is ever stored. A phone
 * photo is several megabytes; storing it raw would push both the OPFS quota and
 * the encrypted archive somewhere a family would notice, and the shelf never
 * renders a cover larger than a few hundred pixels anyway.
 *
 * Encoding is JPEG at descending quality until the result fits, rather than a
 * single guess, because how well an image compresses depends entirely on the
 * image. If even the lowest quality is too large the cover is refused with a
 * message, which is better than silently storing something that breaks the cap.
 */
export async function downscaleCover(file: File): Promise<DownscaledCover> {
  return downscaleCoverBlob(file);
}

/** The catalog path receives a Blob rather than a File, but it must pass through
 * the exact same storage caps as a household-selected image. */
export async function downscaleCoverBlob(blob: Blob): Promise<DownscaledCover> {
  if (!blob.type.startsWith('image/')) throw new Error('That file is not an image.');
  const bitmap = await createImageBitmap(blob).catch(() => {
    throw new Error('That image could not be read.');
  });
  try {
    const scale = Math.min(MAX_COVER_WIDTH / bitmap.width, MAX_COVER_HEIGHT / bitmap.height, 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser cannot resize images.');
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= MAX_COVER_BYTES) {
        return {
          bytes: new Uint8Array(await blob.arrayBuffer()),
          mime: 'image/jpeg',
          width,
          height,
        };
      }
    }
    throw new Error('That image is too detailed to store as a cover. Try a simpler photo.');
  } finally {
    bitmap.close();
  }
}
