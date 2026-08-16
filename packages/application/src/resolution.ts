import {
  canonicalAuthor,
  canonicalTitle,
  rankCandidates,
  type CatalogCandidate,
  type ResolutionInput,
} from '@read-it-again/domain';
import {
  acceptCachedResolution,
  acceptCandidate,
  applyExclusiveCardAttribution,
  createManualResolution,
  deferResolution,
  ensureResolutionCase,
  listResolutionQueue,
  rejectResolution,
  replaceResolutionCandidates,
  type Database,
  type ResolutionQueueItem,
} from '@read-it-again/storage-schema';
import { recomputeAttributions } from './attribution.js';
import {
  AUTOMATIC_RESOLUTION_CONFIDENCE,
  type CompositionDefaults,
} from './composition-defaults.js';
import { rebuildReadingModel } from './reading.js';

export interface CatalogPort {
  searchByIsbn(isbn: string): Promise<readonly CatalogCandidate[]>;
  searchByTitleAuthor(title: string, authorFamily?: string): Promise<readonly CatalogCandidate[]>;
}

export interface PrepareResolutionResult {
  readonly casesCreated: number;
  readonly cacheHits: number;
  readonly automaticallyResolved: number;
  readonly pending: number;
  readonly deterministicallyAttributed: number;
  readonly queue: readonly ResolutionQueueItem[];
}

interface ImportRow {
  readonly id: string;
  readonly title: string;
  readonly authors_json: string;
  readonly isbn: string | null;
  readonly source_format: string | null;
  readonly call_number: string | null;
  readonly source_kind: string;
}

export async function prepareResolutionQueue(
  database: Database,
  catalog: CatalogPort,
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly defaults?: CompositionDefaults;
  } = {},
): Promise<PrepareResolutionResult> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = (options.now ?? (() => new Date()))().toISOString();
  const rows = await database.query<ImportRow>(
    `SELECT r.id, r.title, r.authors_json, r.isbn, r.source_format, r.call_number,
            s.kind AS source_kind
     FROM import_records r JOIN source_accounts s ON s.id = r.source_account_id
     LEFT JOIN resolution_cases c ON c.import_record_id = r.id
     WHERE c.id IS NULL ORDER BY r.occurred_at, r.id`,
  );
  let cacheHits = 0;
  let automaticallyResolved = 0;

  for (const row of rows) {
    const authors = parseAuthorDisplays(row.authors_json);
    const cacheKey = resolutionCacheKey(
      row.source_kind,
      row.title,
      authors,
      row.source_format ?? undefined,
      row.call_number ?? undefined,
    );
    const resolutionCase = await ensureResolutionCase(database, {
      id: idFactory(),
      importRecordId: row.id,
      cacheKey,
      algorithmVersion: 'resolution-v1',
      now,
    });
    const cache = await database.query<{ edition_id: string; confidence: number }>(
      `SELECT edition_id, confidence FROM resolution_cache
       WHERE source_kind = ? AND cache_key = ?`,
      [row.source_kind, cacheKey],
    );
    if (cache[0]) {
      await acceptCachedResolution(database, {
        caseId: resolutionCase.id,
        decisionId: idFactory(),
        editionId: cache[0].edition_id,
        confidence: cache[0].confidence,
        now,
      });
      cacheHits += 1;
      continue;
    }

    const input: ResolutionInput = {
      title: row.title,
      authorDisplays: authors,
      isbn: row.isbn ?? undefined,
      format: row.source_format ?? undefined,
    };
    let candidates: readonly CatalogCandidate[] = [];
    if (row.isbn) candidates = await catalog.searchByIsbn(row.isbn);
    if (candidates.length === 0) {
      const firstAuthor = authors[0];
      const authorFamily = firstAuthor ? canonicalAuthor(firstAuthor).split(' ')[0] : undefined;
      candidates = await catalog.searchByTitleAuthor(row.title, authorFamily);
    }
    const ranked = rankCandidates(input, deduplicateCandidates(candidates)).slice(0, 5);
    const drafts = ranked.map((ranking) => ({
      id: idFactory(),
      catalogNamespace: 'kcls-bibid',
      catalogKey: ranking.candidate.catalogKey,
      rank: ranking.rank,
      totalScore: ranking.score.total,
      margin: ranking.margin,
      scoreJson: JSON.stringify(ranking.score),
      snapshotJson: JSON.stringify(ranking.candidate),
    }));
    await replaceResolutionCandidates(database, resolutionCase.id, drafts, now);
    const top = ranked[0];
    if (top?.automatic && drafts[0]) {
      await acceptCandidate(database, {
        caseId: resolutionCase.id,
        candidateId: drafts[0].id,
        decisionId: idFactory(),
        workId: idFactory(),
        editionId: idFactory(),
        identifierId: idFactory(),
        method: row.isbn && top.score.isbn === 1 ? 'isbn' : 'search',
        confidence: top.score.total,
        now,
        sourceKind: row.source_kind,
        cacheKey,
      });
      automaticallyResolved += 1;
      continue;
    }
    // No catalog candidate. Where the composition has no catalog at all (the
    // browser), leaving this pending means the book never reaches the shelf, so
    // take the source record at its word. Only ever applied to a case created in
    // this pass, so a deferred case stays deferred.
    if (options.defaults?.acceptSourceDetails && ranked.length === 0 && row.title.trim()) {
      await createManualResolution(database, {
        caseId: resolutionCase.id,
        decisionId: idFactory(),
        workId: idFactory(),
        editionId: idFactory(),
        title: row.title,
        authorsJson: row.authors_json,
        confidence: AUTOMATIC_RESOLUTION_CONFIDENCE,
        now,
      });
      automaticallyResolved += 1;
    }
  }

  const queue = await listResolutionQueue(database);
  const deterministicallyAttributed = await applyExclusiveCardAttribution(database, {
    idFactory,
    now,
  });
  await recomputeAttributions(database, { idFactory, now, defaults: options.defaults });
  await rebuildReadingModel(database, { idFactory, now: () => new Date(now) });
  return {
    casesCreated: rows.length,
    cacheHits,
    automaticallyResolved,
    pending: queue.length,
    deterministicallyAttributed,
    queue,
  };
}

export async function decideCandidate(
  database: Database,
  caseId: string,
  candidateId: string,
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly defaults?: CompositionDefaults;
  } = {},
): Promise<void> {
  const id = options.idFactory ?? (() => crypto.randomUUID());
  const now = (options.now ?? (() => new Date()))().toISOString();
  const cases = await database.query<{ cache_key: string; source_kind: string }>(
    `SELECT c.cache_key, s.kind AS source_kind
     FROM resolution_cases c
     JOIN import_records r ON r.id = c.import_record_id
     JOIN source_accounts s ON s.id = r.source_account_id
     WHERE c.id = ?`,
    [caseId],
  );
  if (!cases[0]) throw new Error('Resolution case does not exist');
  await acceptCandidate(database, {
    caseId,
    candidateId,
    decisionId: id(),
    workId: id(),
    editionId: id(),
    identifierId: id(),
    method: 'human',
    confidence: 1,
    now,
    sourceKind: cases[0].source_kind,
    cacheKey: cases[0].cache_key,
  });
  await applyExclusiveCardAttribution(database, { idFactory: id, now });
  await recomputeAttributions(database, { idFactory: id, now, defaults: options.defaults });
  await rebuildReadingModel(database, { idFactory: id, now: () => new Date(now) });
}

export async function createManualWorkForCase(
  database: Database,
  caseId: string,
  title: string,
  authorsJson: string,
  options: {
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    readonly defaults?: CompositionDefaults;
  } = {},
): Promise<void> {
  const id = options.idFactory ?? (() => crypto.randomUUID());
  const now = (options.now ?? (() => new Date()))().toISOString();
  await createManualResolution(database, {
    caseId,
    decisionId: id(),
    workId: id(),
    editionId: id(),
    title,
    authorsJson,
    now,
  });
  await applyExclusiveCardAttribution(database, {
    idFactory: id,
    now,
  });
  await recomputeAttributions(database, {
    idFactory: id,
    now,
    defaults: options.defaults,
  });
  await rebuildReadingModel(database, { idFactory: id, now: () => new Date(now) });
}

export async function rejectCase(database: Database, caseId: string): Promise<void> {
  await rejectResolution(database, caseId, crypto.randomUUID(), new Date().toISOString());
}

export async function deferCase(database: Database, caseId: string): Promise<void> {
  await deferResolution(database, caseId, crypto.randomUUID(), new Date().toISOString());
}

function parseAuthorDisplays(authorsJson: string): readonly string[] {
  const value = JSON.parse(authorsJson) as unknown;
  if (!Array.isArray(value)) return [];
  const output: string[] = [];
  for (const author of value as unknown[]) {
    if (typeof author === 'string') output.push(author);
    else if (hasDisplay(author)) output.push(author.display);
  }
  return output;
}

function hasDisplay(value: unknown): value is { readonly display: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    'display' in value &&
    typeof (value as { readonly display?: unknown }).display === 'string'
  );
}

function resolutionCacheKey(
  sourceKind: string,
  title: string,
  authors: readonly string[],
  format: string | undefined,
  callNumber: string | undefined,
): string {
  const shape =
    sourceKind === 'bibliocommons'
      ? [canonicalTitle(title), authors.map(canonicalAuthor).sort().join('|'), callNumber ?? '']
      : [canonicalTitle(title), authors.map(canonicalAuthor).sort().join('|'), format ?? ''];
  return ['v1', ...shape].join('::');
}

function deduplicateCandidates(
  candidates: readonly CatalogCandidate[],
): readonly CatalogCandidate[] {
  return [...new Map(candidates.map((candidate) => [candidate.catalogKey, candidate])).values()];
}
