import type { Database } from './database.js';
import { inTransaction } from './database.js';

export interface HoldingsView {
  readonly catalogKey: string;
  readonly systemAvailable: number;
  readonly systemTotal: number;
  readonly branches: readonly {
    readonly shortName: string;
    readonly name: string;
    readonly available: number | null;
    readonly callNumbers: readonly string[];
  }[];
  readonly sourceUrl: string;
  readonly fetchedAt: string;
  readonly expiresAt: string;
}

export interface RecommendationView {
  readonly generatedAt: string | null;
  readonly constraints: {
    readonly allowedFormats: readonly string[];
    readonly maxReadMinutes?: number;
    readonly maxPerAuthor: number;
    readonly maxPerSubject: number;
  } | null;
  readonly discovery: readonly RecommendationItemView[];
  readonly readAgain: readonly RecommendationItemView[];
}

export interface RecommendationItemView {
  readonly catalogKey: string;
  readonly workId: string | null;
  readonly title: string;
  readonly authors: readonly string[];
  readonly score: number;
  readonly evidence: readonly string[];
  readonly components: Readonly<Record<string, number>>;
  readonly estimatedReadMinutes: number | null;
  readonly holdings: HoldingsView;
}

export async function saveHoldings(database: Database, holdings: HoldingsView): Promise<void> {
  await database.run(
    `INSERT INTO holdings_cache (catalog_key, system_available, system_total, branches_json, source_url, fetched_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (catalog_key) DO UPDATE SET
       system_available = excluded.system_available, system_total = excluded.system_total,
       branches_json = excluded.branches_json, source_url = excluded.source_url,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [
      holdings.catalogKey,
      holdings.systemAvailable,
      holdings.systemTotal,
      JSON.stringify(holdings.branches),
      holdings.sourceUrl,
      holdings.fetchedAt,
      holdings.expiresAt,
    ],
  );
}

export async function getFreshHoldings(
  database: Database,
  catalogKey: string,
  now: Date,
): Promise<HoldingsView | undefined> {
  const row = (
    await database.query<HoldingsRow>(
      'SELECT * FROM holdings_cache WHERE catalog_key = ? AND expires_at > ?',
      [catalogKey, now.toISOString()],
    )
  )[0];
  return row ? mapHoldings(row) : undefined;
}

export async function saveRecommendationRun(
  database: Database,
  input: {
    readonly id: string;
    readonly householdId: string;
    readonly personId: string;
    readonly constraints: RecommendationView['constraints'];
    readonly seedCount: number;
    readonly candidateCount: number;
    readonly generatedAt: string;
    readonly items: readonly {
      readonly id: string;
      readonly kind: 'discovery' | 'read_again';
      readonly rank: number;
      readonly catalogKey: string;
      readonly workId?: string;
      readonly title: string;
      readonly authors: readonly string[];
      readonly score: number;
      readonly evidence: readonly string[];
      readonly components: Readonly<Record<string, number>>;
      readonly estimatedReadMinutes?: number;
      readonly metadata: unknown;
      readonly holdingsObservedAt: string;
    }[];
  },
): Promise<void> {
  await inTransaction(database, async () => {
    await database.run(
      `INSERT INTO recommendation_runs (id, household_id, person_id, constraints_json, seed_count, candidate_count, algorithm_version, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'recommendations-v1', ?)`,
      [
        input.id,
        input.householdId,
        input.personId,
        JSON.stringify(input.constraints),
        input.seedCount,
        input.candidateCount,
        input.generatedAt,
      ],
    );
    for (const item of input.items) {
      await database.run(
        `INSERT INTO recommendation_items (id, recommendation_run_id, kind, rank, catalog_key, work_id, title, authors_json, score, evidence_json, components_json, estimated_read_minutes, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          input.id,
          item.kind,
          item.rank,
          item.catalogKey,
          item.workId ?? null,
          item.title,
          JSON.stringify(item.authors),
          item.score,
          JSON.stringify(item.evidence),
          JSON.stringify(item.components),
          item.estimatedReadMinutes ?? null,
          JSON.stringify(item.metadata),
        ],
      );
      await database.run(
        'INSERT INTO recommendation_item_holdings (recommendation_item_id, catalog_key, observed_at) VALUES (?, ?, ?)',
        [item.id, item.catalogKey, item.holdingsObservedAt],
      );
    }
  });
}

export async function getRecommendations(
  database: Database,
  personId?: string,
): Promise<RecommendationView> {
  const run = (
    await database.query<{ id: string; constraints_json: string; generated_at: string }>(
      `SELECT id, constraints_json, generated_at FROM recommendation_runs
     ${personId ? 'WHERE person_id = ?' : ''} ORDER BY generated_at DESC, id DESC LIMIT 1`,
      personId ? [personId] : [],
    )
  )[0];
  if (!run) return { generatedAt: null, constraints: null, discovery: [], readAgain: [] };
  const rows = await database.query<ItemRow>(
    `SELECT i.*, h.system_available, h.system_total, h.branches_json, h.source_url, h.fetched_at, h.expires_at
     FROM recommendation_items i JOIN recommendation_item_holdings ih ON ih.recommendation_item_id = i.id
     JOIN holdings_cache h ON h.catalog_key = ih.catalog_key WHERE i.recommendation_run_id = ?
     ORDER BY i.kind, i.rank`,
    [run.id],
  );
  const mapped = rows.map(mapItem);
  return {
    generatedAt: run.generated_at,
    constraints: JSON.parse(run.constraints_json) as NonNullable<RecommendationView['constraints']>,
    discovery: mapped.filter(({ kind }) => kind === 'discovery').map(withoutKind),
    readAgain: mapped.filter(({ kind }) => kind === 'read_again').map(withoutKind),
  };
}

interface HoldingsRow {
  readonly catalog_key: string;
  readonly system_available: number;
  readonly system_total: number;
  readonly branches_json: string;
  readonly source_url: string;
  readonly fetched_at: string;
  readonly expires_at: string;
}

interface ItemRow extends HoldingsRow {
  readonly kind: 'discovery' | 'read_again';
  readonly work_id: string | null;
  readonly title: string;
  readonly authors_json: string;
  readonly score: number;
  readonly evidence_json: string;
  readonly components_json: string;
  readonly estimated_read_minutes: number | null;
}

function mapHoldings(row: HoldingsRow): HoldingsView {
  return {
    catalogKey: row.catalog_key,
    systemAvailable: row.system_available,
    systemTotal: row.system_total,
    branches: JSON.parse(row.branches_json) as HoldingsView['branches'],
    sourceUrl: row.source_url,
    fetchedAt: row.fetched_at,
    expiresAt: row.expires_at,
  };
}

function mapItem(
  row: ItemRow,
): RecommendationItemView & { readonly kind: 'discovery' | 'read_again' } {
  return {
    kind: row.kind,
    catalogKey: row.catalog_key,
    workId: row.work_id,
    title: row.title,
    authors: JSON.parse(row.authors_json) as string[],
    score: row.score,
    evidence: JSON.parse(row.evidence_json) as string[],
    components: JSON.parse(row.components_json) as Record<string, number>,
    estimatedReadMinutes: row.estimated_read_minutes,
    holdings: mapHoldings(row),
  };
}

function withoutKind(
  value: RecommendationItemView & { readonly kind: 'discovery' | 'read_again' },
): RecommendationItemView {
  return {
    catalogKey: value.catalogKey,
    workId: value.workId,
    title: value.title,
    authors: value.authors,
    score: value.score,
    evidence: value.evidence,
    components: value.components,
    estimatedReadMinutes: value.estimatedReadMinutes,
    holdings: value.holdings,
  };
}
