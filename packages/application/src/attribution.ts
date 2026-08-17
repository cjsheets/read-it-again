import {
  assessAttribution,
  type AttributionAssessment,
  type CatalogMetadata,
} from '@read-it-again/domain';
import {
  inTransaction,
  listAttributionTriage,
  saveAttributionOverride,
  storeMetadataFacts,
  writeAttributionResult,
  type AttributionTriageItem,
  type Database,
} from '@read-it-again/storage-schema';
import { mergeWorks, repointResolution, splitEditionToWork } from '@read-it-again/storage-schema';
import { applySingleReaderDefault, type CompositionDefaults } from './composition-defaults.js';

export interface EnrichmentCatalogPort {
  getMarcMetadata(bibid: string): Promise<CatalogMetadata>;
}

interface ResolvedRow {
  readonly import_record_id: string;
  readonly edition_id: string;
  readonly work_id: string;
  readonly call_number: string | null;
  readonly source_format: string | null;
  readonly bibid: string | null;
  readonly exclusive_owner_id: string | null;
  readonly exclusive: number | null;
  readonly household_id: string;
}

interface CurrentResult {
  readonly state: string;
  readonly method: string;
  readonly confidence: number;
  readonly score: number;
  readonly explanation: string;
  readonly readerIds: readonly string[];
}

export async function enrichResolvedCatalogRecords(
  database: Database,
  catalog: EnrichmentCatalogPort,
  options: { readonly idFactory?: () => string; readonly now?: () => Date } = {},
): Promise<{
  readonly editionsEnriched: number;
  readonly attributionResultsChanged: number;
  readonly triage: readonly AttributionTriageItem[];
}> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = (options.now ?? (() => new Date()))().toISOString();
  const editions = await database.query<{ edition_id: string; bibid: string }>(
    `SELECT DISTINCT e.id AS edition_id, x.value AS bibid
     FROM editions e
     JOIN external_identifiers x ON x.entity_kind = 'edition' AND x.entity_id = e.id
       AND x.namespace = 'kcls-bibid'
     LEFT JOIN metadata_facts f ON f.entity_kind = 'edition' AND f.entity_id = e.id
       AND f.source = 'marc' AND f.source_ref = x.value
     WHERE f.id IS NULL ORDER BY e.id`,
  );
  for (const edition of editions) {
    await storeMetadataFacts(database, {
      entityKind: 'edition',
      entityId: edition.edition_id,
      source: 'marc',
      sourceRef: edition.bibid,
      metadata: await catalog.getMarcMetadata(edition.bibid),
      idFactory,
      fetchedAt: now,
    });
  }
  const attributionResultsChanged = await recomputeAttributions(database, { idFactory, now });
  const { rebuildReadingModel } = await import('./reading.js');
  await rebuildReadingModel(database, { idFactory, now: () => new Date(now) });
  return {
    editionsEnriched: editions.length,
    attributionResultsChanged,
    triage: await listAttributionTriage(database),
  };
}

export async function recomputeAttributions(
  database: Database,
  options: {
    readonly idFactory?: () => string;
    readonly now?: string;
    readonly defaults?: CompositionDefaults;
    readonly workIds?: readonly string[];
  } = {},
): Promise<number> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? new Date().toISOString();
  if (options.workIds?.length === 0) return 0;
  const rows = await resolvedRows(database, options.workIds);
  const overrides = await currentOverrides(database);
  const readersByHousehold = await activeReadersByHousehold(database);
  const metadataByEdition = await effectiveMetadataByEdition(database);
  const currentResults = await currentAttributionResults(database);
  let changed = 0;
  for (const row of rows) {
    const override =
      overrides.checkout.get(row.import_record_id) ?? overrides.work.get(row.work_id);
    let method:
      'checkout_override' | 'work_override' | 'exclusive_card' | 'evidence_rules' | 'unresolved';
    let assessment: AttributionAssessment;
    if (override) {
      method = override.method;
      assessment = humanAssessment(override.state, override.readerIds);
    } else if (row.exclusive === 1 && row.exclusive_owner_id) {
      method = 'exclusive_card';
      assessment = {
        state: 'assigned',
        readerIds: [row.exclusive_owner_id],
        confidence: 1,
        score: 1,
        explanation: 'This checkout came from a card configured as exclusive to this reader.',
        evidence: [
          {
            signal: 'exclusive_card',
            value: row.exclusive_owner_id,
            weight: 1,
            explanation: 'The library card has one exclusive owner.',
          },
        ],
        algorithmVersion: 'attribution-v1',
      };
    } else {
      const readerIds = readersByHousehold.get(row.household_id) ?? [];
      const metadata = metadataByEdition.get(row.edition_id) ?? {};
      assessment = assessAttribution({
        callNumber: row.call_number ?? metadata.callNumber,
        sourceFormat: row.source_format ?? undefined,
        audience: metadata.audience,
        juvenileHeading: metadata.juvenileHeading,
        genres: metadata.genres,
        pageCount: metadata.pageCount,
        candidateReaderIds: readerIds,
      });
      if (options.defaults?.assignSingleReader) {
        assessment = applySingleReaderDefault(assessment, readerIds);
      }
      method = assessment.evidence.length > 0 ? 'evidence_rules' : 'unresolved';
    }
    if (resultMatches(currentResults.get(row.import_record_id), method, assessment)) continue;
    await writeAttributionResult(database, {
      id: idFactory(),
      importRecordId: row.import_record_id,
      method,
      assessment,
      evidenceIdFactory: idFactory,
      now,
    });
    changed += 1;
  }
  return changed;
}

export async function correctAttribution(
  database: Database,
  input: {
    readonly scope: 'checkout' | 'work';
    readonly importRecordId?: string;
    readonly workId?: string;
    readonly state: 'assigned' | 'excluded';
    readonly readerIds: readonly string[];
    readonly note?: string;
    readonly idFactory?: () => string;
    readonly now?: () => Date;
    // Threaded through so a corrected book follows the same household defaults as
    // the bulk attribution pass.
    readonly defaults?: CompositionDefaults;
  },
): Promise<void> {
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const now = (input.now ?? (() => new Date()))().toISOString();
  const workIds =
    input.scope === 'work' && input.workId
      ? [input.workId]
      : await workIdsForImportRecord(database, input.importRecordId);
  const { rebuildReadingModelForWorks } = await import('./reading.js');
  // Rebuild only the work touched by this correction.
  await inTransaction(database, async () => {
    await saveAttributionOverride(database, { ...input, id: idFactory(), now });
    await recomputeAttributions(database, {
      idFactory,
      now,
      defaults: input.defaults,
      workIds,
    });
    await rebuildReadingModelForWorks(database, workIds, {
      idFactory,
      now: () => new Date(now),
    });
  });
}

export async function mergeWorksAndRecompute(
  database: Database,
  input: Parameters<typeof mergeWorks>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await mergeWorks(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
  const { rebuildReadingModel } = await import('./reading.js');
  await rebuildReadingModel(database, {
    idFactory: options.idFactory,
    now: () => new Date(input.now),
  });
}

export async function splitEditionAndRecompute(
  database: Database,
  input: Parameters<typeof splitEditionToWork>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await splitEditionToWork(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
  const { rebuildReadingModel } = await import('./reading.js');
  await rebuildReadingModel(database, {
    idFactory: options.idFactory,
    now: () => new Date(input.now),
  });
}

export async function repointResolutionAndRecompute(
  database: Database,
  input: Parameters<typeof repointResolution>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await repointResolution(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
  const { rebuildReadingModel } = await import('./reading.js');
  await rebuildReadingModel(database, {
    idFactory: options.idFactory,
    now: () => new Date(input.now),
  });
}

async function resolvedRows(
  database: Database,
  workIds?: readonly string[],
): Promise<readonly ResolvedRow[]> {
  const workFilter = workIds ? ` AND e.work_id IN (${workIds.map(() => '?').join(', ')})` : '';
  return database.query<ResolvedRow>(
    `SELECT r.id AS import_record_id, d.edition_id, e.work_id, r.call_number, r.source_format,
            x.value AS bibid, card.owner_person_id AS exclusive_owner_id, card.exclusive
            , s.household_id
     FROM import_records r
     JOIN resolution_cases c ON c.import_record_id = r.id AND c.status = 'resolved'
     JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
       AND d.action IN ('accept', 'repoint')
     JOIN editions e ON e.id = d.edition_id
     LEFT JOIN external_identifiers x ON x.entity_kind = 'edition' AND x.entity_id = e.id
       AND x.namespace = 'kcls-bibid'
     LEFT JOIN source_accounts s ON s.id = r.source_account_id
     LEFT JOIN library_cards card ON card.id = s.card_id
     WHERE 1 = 1${workFilter}
     ORDER BY r.occurred_at, r.id`,
    workIds ? [...workIds] : [],
  );
}

async function workIdsForImportRecord(
  database: Database,
  importRecordId?: string,
): Promise<readonly string[]> {
  if (!importRecordId) throw new Error('checkout override requires its target');
  const rows = await database.query<{ work_id: string }>(
    `SELECT DISTINCT e.work_id FROM resolution_cases c
     JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
       AND d.action IN ('accept', 'repoint')
     JOIN editions e ON e.id = d.edition_id
     WHERE c.import_record_id = ?`,
    [importRecordId],
  );
  return rows.map(({ work_id }) => work_id);
}

function humanAssessment(
  state: 'assigned' | 'excluded',
  readerIds: readonly string[],
): AttributionAssessment {
  return {
    state,
    readerIds: state === 'assigned' ? readerIds : [],
    confidence: 1,
    score: state === 'assigned' ? 1 : -1,
    explanation: 'A household member explicitly corrected this attribution.',
    evidence: [],
    algorithmVersion: 'attribution-v1',
  };
}

function resultMatches(
  row: CurrentResult | undefined,
  method: string,
  assessment: AttributionAssessment,
): boolean {
  if (
    !row ||
    row.state !== assessment.state ||
    row.method !== method ||
    row.confidence !== assessment.confidence ||
    row.score !== assessment.score ||
    row.explanation !== assessment.explanation
  )
    return false;
  return JSON.stringify(row.readerIds) === JSON.stringify([...assessment.readerIds].sort());
}

async function activeReadersByHousehold(
  database: Database,
): Promise<ReadonlyMap<string, readonly string[]>> {
  const rows = await database.query<{ household_id: string; person_id: string }>(
    `SELECT p.household_id, p.id AS person_id FROM people p
     JOIN reader_profiles r ON r.person_id = p.id
     WHERE r.kind = 'child' AND r.archived_at IS NULL ORDER BY p.household_id, p.id`,
  );
  return groupValues(rows, 'household_id', 'person_id');
}

async function effectiveMetadataByEdition(
  database: Database,
): Promise<ReadonlyMap<string, Partial<CatalogMetadata>>> {
  const rows = await database.query<{
    entity_id: string;
    field: string;
    value_json: string;
  }>(
    `SELECT entity_id, field, value_json FROM metadata_facts WHERE entity_kind = 'edition'
     ORDER BY entity_id, field, precedence DESC, fetched_at DESC, id DESC`,
  );
  const output = new Map<string, Partial<CatalogMetadata>>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.entity_id}\u0000${row.field}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const metadata = output.get(row.entity_id) ?? {};
    Object.assign(metadata, { [row.field]: JSON.parse(row.value_json) as unknown });
    output.set(row.entity_id, metadata);
  }
  return output;
}

type OverrideView = {
  readonly method: 'checkout_override' | 'work_override';
  readonly state: 'assigned' | 'excluded';
  readonly readerIds: readonly string[];
};

async function currentOverrides(database: Database): Promise<{
  readonly checkout: ReadonlyMap<string, OverrideView>;
  readonly work: ReadonlyMap<string, OverrideView>;
}> {
  const rows = await database.query<{
    id: string;
    scope: 'checkout' | 'work';
    import_record_id: string | null;
    work_id: string | null;
    state: 'assigned' | 'excluded';
    person_id: string | null;
  }>(
    `SELECT o.id, o.scope, o.import_record_id, o.work_id, o.state, r.person_id
     FROM attribution_overrides o LEFT JOIN attribution_override_readers r ON r.override_id = o.id
     WHERE o.current = 1 ORDER BY o.id, r.person_id`,
  );
  const checkout = new Map<string, OverrideView>();
  const work = new Map<string, OverrideView>();
  for (const row of rows) {
    const target = row.scope === 'checkout' ? row.import_record_id : row.work_id;
    if (!target) continue;
    const map = row.scope === 'checkout' ? checkout : work;
    const existing = map.get(target);
    map.set(target, {
      method: row.scope === 'checkout' ? 'checkout_override' : 'work_override',
      state: row.state,
      readerIds: row.person_id
        ? [...(existing?.readerIds ?? []), row.person_id]
        : (existing?.readerIds ?? []),
    });
  }
  return { checkout, work };
}

async function currentAttributionResults(
  database: Database,
): Promise<ReadonlyMap<string, CurrentResult>> {
  const rows = await database.query<{
    import_record_id: string;
    state: string;
    method: string;
    confidence: number;
    score: number;
    explanation: string;
    person_id: string | null;
  }>(
    `SELECT a.import_record_id, a.state, a.method, a.confidence, a.score, a.explanation,
            r.person_id FROM attribution_results a
     LEFT JOIN attribution_result_readers r ON r.attribution_result_id = a.id
     WHERE a.current = 1 ORDER BY a.import_record_id, r.person_id`,
  );
  const output = new Map<string, CurrentResult>();
  for (const row of rows) {
    const existing = output.get(row.import_record_id);
    output.set(row.import_record_id, {
      ...row,
      readerIds: row.person_id
        ? [...(existing?.readerIds ?? []), row.person_id]
        : (existing?.readerIds ?? []),
    });
  }
  return output;
}

function groupValues<K extends string, V extends string>(
  rows: readonly Record<K | V, string>[],
  key: K,
  value: V,
): ReadonlyMap<string, readonly string[]> {
  const output = new Map<string, string[]>();
  for (const row of rows) output.set(row[key], [...(output.get(row[key]) ?? []), row[value]]);
  return output;
}
