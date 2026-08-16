import type { Database } from './database.js';
import { inTransaction } from './database.js';

export interface CandidateDraft {
  readonly id: string;
  readonly catalogNamespace: string;
  readonly catalogKey: string;
  readonly rank: number;
  readonly totalScore: number;
  readonly margin: number;
  readonly scoreJson: string;
  readonly snapshotJson: string;
}

export interface ResolutionCase {
  readonly id: string;
  readonly importRecordId: string;
  readonly cacheKey: string;
  readonly status: 'pending' | 'resolved' | 'rejected' | 'deferred';
}

export interface ResolutionQueueItem {
  readonly caseId: string;
  readonly importRecordId: string;
  readonly title: string;
  readonly authorsJson: string;
  readonly sourceFormat: string | null;
  readonly isbn: string | null;
  readonly status: string;
  readonly candidates: readonly {
    readonly id: string;
    readonly rank: number;
    readonly totalScore: number;
    readonly margin: number;
    readonly snapshotJson: string;
  }[];
}

export async function ensureResolutionCase(
  database: Database,
  input: {
    readonly id: string;
    readonly importRecordId: string;
    readonly cacheKey: string;
    readonly algorithmVersion: string;
    readonly now: string;
  },
): Promise<ResolutionCase> {
  await database.run(
    `INSERT INTO resolution_cases
     (id, import_record_id, cache_key, status, algorithm_version, created_at, updated_at)
     VALUES (?, ?, ?, 'pending', ?, ?, ?)
     ON CONFLICT (import_record_id) DO NOTHING`,
    [input.id, input.importRecordId, input.cacheKey, input.algorithmVersion, input.now, input.now],
  );
  const rows = await database.query<{
    id: string;
    import_record_id: string;
    cache_key: string;
    status: ResolutionCase['status'];
  }>(
    `SELECT id, import_record_id, cache_key, status
     FROM resolution_cases WHERE import_record_id = ?`,
    [input.importRecordId],
  );
  const row = rows[0];
  if (!row) throw new Error('Resolution case was not created');
  return {
    id: row.id,
    importRecordId: row.import_record_id,
    cacheKey: row.cache_key,
    status: row.status,
  };
}

export async function replaceResolutionCandidates(
  database: Database,
  caseId: string,
  candidates: readonly CandidateDraft[],
  now: string,
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run('DELETE FROM resolution_candidates WHERE resolution_case_id = ?', [caseId]);
    for (const candidate of candidates) {
      await database.run(
        `INSERT INTO resolution_candidates
         (id, resolution_case_id, catalog_namespace, catalog_key, rank, total_score, margin,
          score_json, snapshot_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          candidate.id,
          caseId,
          candidate.catalogNamespace,
          candidate.catalogKey,
          candidate.rank,
          candidate.totalScore,
          candidate.margin,
          candidate.scoreJson,
          candidate.snapshotJson,
          now,
        ],
      );
    }
    await database.run(
      `UPDATE resolution_cases SET status = 'pending', updated_at = ? WHERE id = ?`,
      [now, caseId],
    );
  });
}

export async function listResolutionQueue(
  database: Database,
): Promise<readonly ResolutionQueueItem[]> {
  const cases = await database.query<{
    case_id: string;
    import_record_id: string;
    title: string;
    authors_json: string;
    source_format: string | null;
    isbn: string | null;
    status: string;
  }>(
    `SELECT c.id AS case_id, r.id AS import_record_id, r.title, r.authors_json,
            r.source_format, r.isbn, c.status
     FROM resolution_cases c JOIN import_records r ON r.id = c.import_record_id
     WHERE c.status IN ('pending', 'deferred') ORDER BY r.occurred_at DESC, c.id`,
  );
  const output: ResolutionQueueItem[] = [];
  for (const item of cases) {
    const candidates = await database.query<{
      id: string;
      rank: number;
      total_score: number;
      margin: number;
      snapshot_json: string;
    }>(
      `SELECT id, rank, total_score, margin, snapshot_json FROM resolution_candidates
       WHERE resolution_case_id = ? ORDER BY rank`,
      [item.case_id],
    );
    output.push({
      caseId: item.case_id,
      importRecordId: item.import_record_id,
      title: item.title,
      authorsJson: item.authors_json,
      sourceFormat: item.source_format,
      isbn: item.isbn,
      status: item.status,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        rank: candidate.rank,
        totalScore: candidate.total_score,
        margin: candidate.margin,
        snapshotJson: candidate.snapshot_json,
      })),
    });
  }
  return output;
}

export async function acceptCandidate(
  database: Database,
  input: {
    readonly caseId: string;
    readonly candidateId: string;
    readonly decisionId: string;
    readonly workId: string;
    readonly editionId: string;
    readonly identifierId: string;
    readonly method: 'isbn' | 'search' | 'human';
    readonly confidence: number;
    readonly now: string;
    readonly sourceKind: string;
    readonly cacheKey: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const candidateRows = await database.query<{
      snapshot_json: string;
      catalog_namespace: string;
      catalog_key: string;
    }>(
      `SELECT snapshot_json, catalog_namespace, catalog_key FROM resolution_candidates WHERE id = ? AND resolution_case_id = ?`,
      [input.candidateId, input.caseId],
    );
    const candidate = candidateRows[0];
    if (!candidate) throw new Error('Resolution candidate does not belong to this case');
    const snapshot = JSON.parse(candidate.snapshot_json) as {
      title: string;
      authorDisplays: string[];
      format?: string;
      publishedYear?: number;
    };
    const existing = await database.query<{ entity_id: string }>(
      `SELECT entity_id FROM external_identifiers
       WHERE namespace = ? AND value = ? AND entity_kind = 'edition'`,
      [candidate.catalog_namespace, candidate.catalog_key],
    );
    const effectiveEditionId = existing[0]?.entity_id ?? input.editionId;
    if (!existing[0]) {
      await database.run(
        `INSERT INTO works (id, canonical_title, primary_author, created_at) VALUES (?, ?, ?, ?)`,
        [input.workId, snapshot.title, snapshot.authorDisplays[0] ?? null, input.now],
      );
      await database.run(
        `INSERT INTO editions
         (id, work_id, title, authors_json, format, published_year, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          input.editionId,
          input.workId,
          snapshot.title,
          JSON.stringify(snapshot.authorDisplays),
          snapshot.format ?? null,
          snapshot.publishedYear ?? null,
          input.now,
        ],
      );
      await database.run(
        `INSERT INTO external_identifiers
         (id, entity_kind, entity_id, namespace, value, source, confidence, created_at)
         VALUES (?, 'edition', ?, ?, ?, 'kcls', ?, ?)`,
        [
          input.identifierId,
          input.editionId,
          candidate.catalog_namespace,
          candidate.catalog_key,
          input.confidence,
          input.now,
        ],
      );
    }
    await database.run(
      `INSERT INTO resolution_cache (source_kind, cache_key, edition_id, method, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (source_kind, cache_key) DO UPDATE SET edition_id = excluded.edition_id,
         method = excluded.method, confidence = excluded.confidence, created_at = excluded.created_at`,
      [
        input.sourceKind,
        input.cacheKey,
        effectiveEditionId,
        input.method,
        input.confidence,
        input.now,
      ],
    );
    await writeDecision(
      database,
      input.caseId,
      input.decisionId,
      'accept',
      effectiveEditionId,
      input.candidateId,
      input.method,
      input.confidence,
      input.now,
    );
  });
}

export async function acceptCachedResolution(
  database: Database,
  input: {
    readonly caseId: string;
    readonly decisionId: string;
    readonly editionId: string;
    readonly confidence: number;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, () =>
    writeDecision(
      database,
      input.caseId,
      input.decisionId,
      'accept',
      input.editionId,
      null,
      'cache',
      input.confidence,
      input.now,
    ),
  );
}

export async function createManualResolution(
  database: Database,
  input: {
    readonly caseId: string;
    readonly decisionId: string;
    readonly workId: string;
    readonly editionId: string;
    readonly title: string;
    readonly authorsJson: string;
    readonly now: string;
    /**
     * 1 means a person chose this. Anything lower means a composition default
     * created the work from source details without asking — see ADR 0012. The
     * decision is append-only either way, so a later human choice supersedes it.
     */
    readonly confidence?: number;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run(
      `INSERT INTO works (id, canonical_title, primary_author, created_at) VALUES (?, ?, NULL, ?)`,
      [input.workId, input.title, input.now],
    );
    await database.run(
      `INSERT INTO editions (id, work_id, title, authors_json, created_at) VALUES (?, ?, ?, ?, ?)`,
      [input.editionId, input.workId, input.title, input.authorsJson, input.now],
    );
    await writeDecision(
      database,
      input.caseId,
      input.decisionId,
      'accept',
      input.editionId,
      null,
      'manual',
      input.confidence ?? 1,
      input.now,
    );
  });
}

export async function rejectResolution(
  database: Database,
  caseId: string,
  decisionId: string,
  now: string,
): Promise<void> {
  await inTransaction(database, () =>
    writeDecision(database, caseId, decisionId, 'reject', null, null, 'human', 1, now),
  );
}

export async function deferResolution(
  database: Database,
  caseId: string,
  decisionId: string,
  now: string,
): Promise<void> {
  await inTransaction(database, () =>
    writeDecision(database, caseId, decisionId, 'defer', null, null, 'human', 1, now),
  );
}

export async function repointResolution(
  database: Database,
  input: {
    readonly caseId: string;
    readonly decisionId: string;
    readonly editionId: string;
    readonly operationId: string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    const superseded = await retireCurrentDecision(database, input.caseId);
    await database.run(
      `INSERT INTO resolution_decisions
       (id, resolution_case_id, action, edition_id, method, confidence,
        supersedes_decision_id, current, created_at)
       VALUES (?, ?, 'repoint', ?, 'human', 1, ?, 1, ?)`,
      [input.decisionId, input.caseId, input.editionId, superseded, input.now],
    );
    await database.run(
      `INSERT INTO identity_operations (id, kind, payload_json, created_at)
       VALUES (?, 'repoint_resolution', ?, ?)`,
      [
        input.operationId,
        JSON.stringify({ caseId: input.caseId, editionId: input.editionId }),
        input.now,
      ],
    );
    await database.run(
      `INSERT INTO derived_rebuilds (id, reason, import_record_id, created_at)
       SELECT ?, 'resolution_repoint', import_record_id, ? FROM resolution_cases WHERE id = ?`,
      [`${input.operationId}:rebuild`, input.now, input.caseId],
    );
    await database.run(
      `UPDATE resolution_cases SET status = 'resolved', updated_at = ? WHERE id = ?`,
      [input.now, input.caseId],
    );
  });
}

export async function mergeWorks(
  database: Database,
  input: {
    readonly survivorWorkId: string;
    readonly mergedWorkId: string;
    readonly operationId: string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run(
      `UPDATE attribution_overrides SET current = 0
       WHERE scope = 'work' AND work_id = ? AND current = 1
         AND EXISTS (SELECT 1 FROM attribution_overrides
           WHERE scope = 'work' AND work_id = ? AND current = 1)`,
      [input.mergedWorkId, input.survivorWorkId],
    );
    await database.run(
      `UPDATE attribution_overrides SET work_id = ?
       WHERE scope = 'work' AND work_id = ? AND current = 1`,
      [input.survivorWorkId, input.mergedWorkId],
    );
    await database.run('UPDATE editions SET work_id = ? WHERE work_id = ?', [
      input.survivorWorkId,
      input.mergedWorkId,
    ]);
    await database.run(
      'UPDATE external_identifiers SET entity_id = ? WHERE entity_kind = ? AND entity_id = ?',
      [input.survivorWorkId, 'work', input.mergedWorkId],
    );
    await database.run('UPDATE works SET retired_at = ? WHERE id = ?', [
      input.now,
      input.mergedWorkId,
    ]);
    await database.run(
      `INSERT INTO identity_operations (id, kind, payload_json, created_at) VALUES (?, 'merge_work', ?, ?)`,
      [input.operationId, JSON.stringify(input), input.now],
    );
    await database.run(
      `INSERT INTO derived_rebuilds (id, reason, work_id, created_at)
       VALUES (?, 'work_merge', ?, ?)`,
      [`${input.operationId}:rebuild`, input.survivorWorkId, input.now],
    );
  });
}

export async function splitEditionToWork(
  database: Database,
  input: {
    readonly editionId: string;
    readonly newWorkId: string;
    readonly title: string;
    readonly operationId: string;
    readonly now: string;
  },
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run(`INSERT INTO works (id, canonical_title, created_at) VALUES (?, ?, ?)`, [
      input.newWorkId,
      input.title,
      input.now,
    ]);
    await database.run('UPDATE editions SET work_id = ? WHERE id = ?', [
      input.newWorkId,
      input.editionId,
    ]);
    await database.run(
      `INSERT INTO identity_operations (id, kind, payload_json, created_at) VALUES (?, 'split_work', ?, ?)`,
      [input.operationId, JSON.stringify(input), input.now],
    );
    await database.run(
      `INSERT INTO derived_rebuilds (id, reason, work_id, created_at)
       VALUES (?, 'work_split', ?, ?)`,
      [`${input.operationId}:rebuild`, input.newWorkId, input.now],
    );
  });
}

async function writeDecision(
  database: Database,
  caseId: string,
  decisionId: string,
  action: 'accept' | 'reject' | 'defer',
  editionId: string | null,
  candidateId: string | null,
  method: 'cache' | 'isbn' | 'search' | 'human' | 'manual',
  confidence: number,
  now: string,
): Promise<void> {
  const superseded = await retireCurrentDecision(database, caseId);
  await database.run(
    `INSERT INTO resolution_decisions
     (id, resolution_case_id, action, edition_id, candidate_id, method, confidence,
      supersedes_decision_id, current, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [decisionId, caseId, action, editionId, candidateId, method, confidence, superseded, now],
  );
  const status = action === 'accept' ? 'resolved' : action === 'reject' ? 'rejected' : 'deferred';
  await database.run('UPDATE resolution_cases SET status = ?, updated_at = ? WHERE id = ?', [
    status,
    now,
    caseId,
  ]);
}

async function retireCurrentDecision(database: Database, caseId: string): Promise<string | null> {
  const current = await database.query<{ id: string }>(
    `SELECT id FROM resolution_decisions WHERE resolution_case_id = ? AND current = 1`,
    [caseId],
  );
  await database.run(
    `UPDATE resolution_decisions SET current = 0
     WHERE resolution_case_id = ? AND current = 1`,
    [caseId],
  );
  return current[0]?.id ?? null;
}
