import type { NormalizedImportRecord } from '@read-it-again/storage-schema';
import { z } from 'zod';

const titleSchema = z
  .object({
    text: z.string().trim().min(1),
    url: z.string(),
    titleId: z.union([z.string(), z.number()]).transform(String),
  })
  .passthrough();

const timelineEntrySchema = z
  .object({
    title: titleSchema,
    author: z.string().trim().min(1),
    publisher: z.string().optional(),
    isbn: z.string().optional(),
    timestamp: z.number().int().nonnegative(),
    activity: z.string().trim().min(1),
    details: z.string().optional(),
    library: z
      .object({
        text: z.string(),
        url: z.string(),
        key: z.string().trim().min(1),
      })
      .passthrough(),
    cover: z
      .object({
        url: z.string(),
        color: z.string().optional(),
        format: z.enum(['ebook', 'audiobook']),
      })
      .passthrough(),
  })
  .passthrough();

const timelineSchema = z.array(timelineEntrySchema);

export interface PersonName {
  readonly family: string;
  readonly given?: string;
  readonly display: string;
  readonly raw: string;
}

export interface LibbyParseResult {
  readonly rowsSeen: number;
  readonly rowsIgnored: number;
  readonly records: readonly NormalizedImportRecord[];
}

export class LibbySnapshotError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Libby snapshot is invalid: ${issues.join('; ')}`);
    this.name = 'LibbySnapshotError';
  }
}

export function parseLibbySnapshot(rawText: string): LibbyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LibbySnapshotError([`JSON could not be parsed: ${detail}`]);
  }

  const parsed = timelineSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LibbySnapshotError(
      parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : 'document';
        return `${path}: ${issue.message}`;
      }),
    );
  }

  const borrowed = parsed.data.filter((entry) => entry.activity.toLowerCase() === 'borrowed');
  return {
    rowsSeen: parsed.data.length,
    rowsIgnored: parsed.data.length - borrowed.length,
    records: borrowed.map((entry) => ({
      sourceKey: sourceKey(entry.library.key, entry.activity, entry.title.titleId, entry.timestamp),
      normalizationVersion: 1,
      rawPayloadJson: JSON.stringify(entry),
      title: entry.title.text,
      authorsJson: JSON.stringify(normalizeAuthors(entry.author)),
      sourceFormat: entry.cover.format,
      isbn: normalizeIsbn(entry.isbn),
      editionIdentifierNamespace: 'overdrive-title',
      editionIdentifierValue: entry.title.titleId,
      occurredAt: new Date(entry.timestamp).toISOString(),
      details: entry.details?.trim() || undefined,
    })),
  };
}

function sourceKey(
  libraryKey: string,
  activity: string,
  titleId: string,
  timestamp: number,
): string {
  return ['libby', 'v1', libraryKey, activity.toLowerCase(), titleId, String(timestamp)]
    .map(encodeURIComponent)
    .join(':');
}

function normalizeIsbn(isbn: string | undefined): string | undefined {
  if (!isbn) return undefined;
  const normalized = isbn.toUpperCase().replaceAll(/[^0-9X]/g, '');
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeAuthors(rawAuthors: string): readonly PersonName[] {
  return rawAuthors.split(',').map((rawPart) => {
    const raw = rawPart.trim();
    const tokens = raw.split(/\s+/u);
    const family = tokens.at(-1) ?? raw;
    const given = tokens.slice(0, -1).join(' ') || undefined;
    return { family, given, display: raw, raw };
  });
}
