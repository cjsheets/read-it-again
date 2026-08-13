import {
  acquireBibliocommonsCards,
  BibliocommonsAcquisitionError,
  parseBibliocommonsSnapshot,
  type BibliocommonsCardSession,
} from '@read-it-again/adapter-bibliocommons';
import { canonicalAuthor, canonicalTitle } from '@read-it-again/domain';
import {
  ensureExclusiveCardContext,
  importNormalizedRecords,
  recordAcquisitionFailure,
  type Database,
  type ExclusiveCardContext,
  type ImportBatchResult,
} from '@read-it-again/storage-schema';

export interface ImportBibliocommonsSnapshotInput extends ExclusiveCardContext {
  readonly rawHtml: string;
  readonly fileName?: string;
  readonly idFactory?: () => string;
  readonly now?: () => Date;
}

export async function importBibliocommonsSnapshot(
  database: Database,
  input: ImportBibliocommonsSnapshotInput,
): Promise<ImportBatchResult> {
  const parsed = parseBibliocommonsSnapshot(input.rawHtml);
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  // Derive every source key before database writes so malformed snapshots are all-or-nothing.
  const records = await Promise.all(
    parsed.records.map(async (record) => ({
      id: idFactory(),
      sourceKey: await physicalSourceKey(input.cardId, record),
      normalizationVersion: 1,
      rawPayloadJson: JSON.stringify(record.rawPayload),
      title: record.title,
      subtitle: record.subtitle,
      authorsJson: JSON.stringify(record.authors),
      sourceFormat: record.sourceFormat,
      callNumber: record.callNumber,
      occurredAt: record.occurredAt,
    })),
  );
  const timestamp = (input.now ?? (() => new Date()))().toISOString();
  await ensureExclusiveCardContext(database, input, timestamp);
  return importNormalizedRecords(database, {
    sourceAccountId: input.sourceAccountId,
    blobId: idFactory(),
    runId: idFactory(),
    blobSha256: await sha256Hex(input.rawHtml),
    fileName: input.fileName,
    mediaType: 'text/html',
    contentText: input.rawHtml,
    byteLength: new TextEncoder().encode(input.rawHtml).byteLength,
    rowsSeen: parsed.rowsSeen,
    rowsIgnored: 0,
    records,
    now: timestamp,
  });
}

export async function acquireAndImportBibliocommonsCards(
  database: Database,
  browser: Parameters<typeof acquireBibliocommonsCards>[0],
  inputs: readonly (ExclusiveCardContext & BibliocommonsCardSession)[],
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly maxPages?: number;
    readonly recentlyReturnedUrl?: string;
  } = {},
): Promise<readonly ImportBatchResult[]> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? (() => new Date());
  for (const input of inputs)
    await ensureExclusiveCardContext(database, input, now().toISOString());

  let snapshots;
  try {
    snapshots = await acquireBibliocommonsCards(browser, inputs, {
      maxPages: options.maxPages,
      recentlyReturnedUrl: options.recentlyReturnedUrl,
    });
  } catch (error) {
    if (error instanceof BibliocommonsAcquisitionError) {
      const source = inputs.find(({ cardId }) => cardId === error.cardId);
      if (source) {
        await recordAcquisitionFailure(database, {
          id: idFactory(),
          sourceAccountId: source.sourceAccountId,
          reason: error.reason,
          message: error.message,
          now: now().toISOString(),
        });
      }
    }
    throw error;
  }

  const results: ImportBatchResult[] = [];
  for (const snapshot of snapshots) {
    const input = inputs.find(({ cardId }) => cardId === snapshot.cardId);
    if (!input) throw new Error(`No import context exists for card ${snapshot.cardId}`);
    results.push(
      await importBibliocommonsSnapshot(database, {
        ...input,
        rawHtml: snapshot.html,
        fileName: `bibliocommons-${snapshot.cardId}.html`,
        idFactory,
        now,
      }),
    );
  }
  return results;
}

export async function physicalSourceKey(
  cardId: string,
  record: {
    readonly title: string;
    readonly authors: readonly { readonly display: string }[];
    readonly callNumber: string;
    readonly occurredAt: string;
  },
): Promise<string> {
  const keyMaterial = [
    cardId,
    canonicalTitle(record.title),
    record.authors
      .map(({ display }) => canonicalAuthor(display))
      .sort()
      .join('|'),
    record.callNumber.toUpperCase().replaceAll(/\s+/gu, ' ').trim(),
    record.occurredAt.slice(0, 10),
  ].join('\u001f');
  return `bibliocommons:v1:${await sha256Hex(keyMaterial)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
