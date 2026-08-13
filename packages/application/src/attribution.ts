import {
  assessAttribution,
  type AttributionAssessment,
  type CatalogMetadata,
} from '@read-it-again/domain';
import {
  getEffectiveMetadata,
  getOverride,
  listAttributionTriage,
  saveAttributionOverride,
  storeMetadataFacts,
  writeAttributionResult,
  type AttributionTriageItem,
  type Database,
} from '@read-it-again/storage-schema';
import { mergeWorks, repointResolution, splitEditionToWork } from '@read-it-again/storage-schema';

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
  return {
    editionsEnriched: editions.length,
    attributionResultsChanged,
    triage: await listAttributionTriage(database),
  };
}

export async function recomputeAttributions(
  database: Database,
  options: { readonly idFactory?: () => string; readonly now?: string } = {},
): Promise<number> {
  const idFactory = options.idFactory ?? (() => crypto.randomUUID());
  const now = options.now ?? new Date().toISOString();
  const rows = await resolvedRows(database);
  let changed = 0;
  for (const row of rows) {
    const override = await getOverride(database, row.import_record_id, row.work_id);
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
      const readers = await database.query<{ person_id: string }>(
        `SELECT p.person_id FROM reader_profiles p JOIN people r ON r.id = p.person_id
         JOIN source_accounts s ON s.household_id = r.household_id
         JOIN import_records i ON i.source_account_id = s.id
         WHERE i.id = ? AND p.kind = 'child' ORDER BY p.person_id`,
        [row.import_record_id],
      );
      const metadata = await getEffectiveMetadata(database, 'edition', row.edition_id);
      assessment = assessAttribution({
        callNumber: row.call_number ?? metadata.callNumber,
        sourceFormat: row.source_format ?? undefined,
        audience: metadata.audience,
        juvenileHeading: metadata.juvenileHeading,
        genres: metadata.genres,
        pageCount: metadata.pageCount,
        candidateReaderIds: readers.map(({ person_id }) => person_id),
      });
      method = assessment.evidence.length > 0 ? 'evidence_rules' : 'unresolved';
    }
    if (await resultMatches(database, row.import_record_id, method, assessment)) continue;
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
  },
): Promise<void> {
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const now = (input.now ?? (() => new Date()))().toISOString();
  await saveAttributionOverride(database, { ...input, id: idFactory(), now });
  await recomputeAttributions(database, { idFactory, now });
}

export async function mergeWorksAndRecompute(
  database: Database,
  input: Parameters<typeof mergeWorks>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await mergeWorks(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
}

export async function splitEditionAndRecompute(
  database: Database,
  input: Parameters<typeof splitEditionToWork>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await splitEditionToWork(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
}

export async function repointResolutionAndRecompute(
  database: Database,
  input: Parameters<typeof repointResolution>[1],
  options: { readonly idFactory?: () => string } = {},
): Promise<void> {
  await repointResolution(database, input);
  await recomputeAttributions(database, { idFactory: options.idFactory, now: input.now });
}

async function resolvedRows(database: Database): Promise<readonly ResolvedRow[]> {
  return database.query<ResolvedRow>(
    `SELECT r.id AS import_record_id, d.edition_id, e.work_id, r.call_number, r.source_format,
            x.value AS bibid, card.owner_person_id AS exclusive_owner_id, card.exclusive
     FROM import_records r
     JOIN resolution_cases c ON c.import_record_id = r.id AND c.status = 'resolved'
     JOIN resolution_decisions d ON d.resolution_case_id = c.id AND d.current = 1
       AND d.action IN ('accept', 'repoint')
     JOIN editions e ON e.id = d.edition_id
     LEFT JOIN external_identifiers x ON x.entity_kind = 'edition' AND x.entity_id = e.id
       AND x.namespace = 'kcls-bibid'
     LEFT JOIN source_accounts s ON s.id = r.source_account_id
     LEFT JOIN library_cards card ON card.id = s.card_id
     ORDER BY r.occurred_at, r.id`,
  );
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

async function resultMatches(
  database: Database,
  importRecordId: string,
  method: string,
  assessment: AttributionAssessment,
): Promise<boolean> {
  const rows = await database.query<{
    id: string;
    state: string;
    method: string;
    confidence: number;
    score: number;
    explanation: string;
  }>(
    `SELECT id, state, method, confidence, score, explanation FROM attribution_results
     WHERE import_record_id = ? AND current = 1`,
    [importRecordId],
  );
  const row = rows[0];
  if (
    !row ||
    row.state !== assessment.state ||
    row.method !== method ||
    row.confidence !== assessment.confidence ||
    row.score !== assessment.score ||
    row.explanation !== assessment.explanation
  )
    return false;
  const readers = await database.query<{ person_id: string }>(
    'SELECT person_id FROM attribution_result_readers WHERE attribution_result_id = ? ORDER BY person_id',
    [row.id],
  );
  return (
    JSON.stringify(readers.map(({ person_id }) => person_id)) ===
    JSON.stringify([...assessment.readerIds].sort())
  );
}
