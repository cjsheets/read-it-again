import { useEffect, useState } from 'react';

/** Stable, contrast-checked colors for generated covers. */
const COVER_HUES = [
  '#24473b',
  '#3c4a6b',
  '#6b3550',
  '#5a4a2f',
  '#2f5551',
  '#5c3a2e',
  '#41355e',
  '#4a4f2c',
] as const;

const COVER_INK = '#fffdf8';

/** Detaches the bytes into a plain ArrayBuffer. A Uint8Array backed by
 *  SharedArrayBuffer — possible here, since the app is cross-origin isolated for
 *  SQLite-WASM — is not a valid BlobPart. */
function copyBytes(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

/** FNV-1a. Any stable hash would do; this one is short and has no dependency. */
function hash(value: string): number {
  let result = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16_777_619);
  }
  return result >>> 0;
}

export function coverHue(workId: string): string {
  return COVER_HUES[hash(workId) % COVER_HUES.length] ?? COVER_HUES[0];
}

/** Renders stored bytes when present and a generated 2:3 cover otherwise. */
export function Cover({
  workId,
  title,
  author,
  bytes,
  mime,
}: {
  readonly workId: string;
  readonly title: string;
  readonly author: string | null;
  readonly bytes?: Uint8Array;
  readonly mime?: string;
}) {
  const url = useBlobUrl(bytes, mime);

  if (url) {
    return (
      <img
        className="cover cover-image"
        src={url}
        alt={`Cover of ${title}`}
        width={400}
        height={600}
      />
    );
  }
  return <GeneratedCover workId={workId} title={title} author={author} />;
}

/**
 * Blob URLs must be revoked or the object stays alive for the life of the
 * document — at a thousand covers that is a real leak, so the lifetime is tied to
 * the component rather than created inline during render.
 */
function useBlobUrl(bytes: Uint8Array | undefined, mime: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!bytes || bytes.byteLength === 0) {
      setUrl(null);
      return;
    }
    // `img-src 'self' data: blob:` already permits this, so displaying a cover
    // needs no CSP amendment at all (ADR 0013).
    const objectUrl = URL.createObjectURL(
      new Blob([copyBytes(bytes)], { type: mime ?? 'image/jpeg' }),
    );
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
  }, [bytes, mime]);
  return url;
}

function GeneratedCover({
  workId,
  title,
  author,
}: {
  readonly workId: string;
  readonly title: string;
  readonly author: string | null;
}) {
  const background = coverHue(workId);
  const lines = wrapTitle(title);
  return (
    <svg
      className="cover cover-generated"
      viewBox="0 0 400 600"
      role="img"
      aria-label={`${title}${author ? ` by ${author}` : ''}`}
      data-testid="generated-cover"
    >
      <rect width="400" height="600" fill={background} />
      <rect
        x="26"
        y="26"
        width="348"
        height="548"
        fill="none"
        stroke={COVER_INK}
        strokeOpacity="0.25"
      />
      <text fill={COVER_INK} fontFamily="Georgia, serif" fontSize="54" x="48" y="150">
        {lines.map((line, index) => (
          <tspan key={line + String(index)} x="48" dy={index === 0 ? 0 : 62}>
            {line}
          </tspan>
        ))}
      </text>
      {author && (
        <text
          fill={COVER_INK}
          fillOpacity="0.82"
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontSize="22"
          x="48"
          y="536"
        >
          {truncate(author, 24)}
        </text>
      )}
    </svg>
  );
}

/** Greedy wrap at roughly the width the 54px serif face fills at this viewBox,
 *  capped so a long title degrades to an ellipsis rather than overrunning the art. */
function wrapTitle(title: string): readonly string[] {
  const words = title.trim().split(/\s+/u);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > 11 && line) {
      lines.push(line);
      line = word;
    } else line = candidate;
    if (lines.length === 4) break;
  }
  if (line && lines.length < 5) lines.push(line);
  if (lines.length === 0) return ['Untitled'];
  return lines.slice(0, 5).map((value) => truncate(value, 13));
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
}
