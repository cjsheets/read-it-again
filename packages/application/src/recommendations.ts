import {
  scoreDiscoveryCandidates,
  type CatalogCandidate,
  type CatalogMetadata,
  type PreferenceFeature,
  type RecommendationCandidate,
} from '@read-it-again/domain';
import {
  getEffectiveMetadata,
  getFreshHoldings,
  getRecommendations,
  saveHoldings,
  saveRecommendationRun,
  type Database,
  type HoldingsView,
  type RecommendationView,
} from '@read-it-again/storage-schema';

export interface RecommendationCatalogPort {
  search(query: string): Promise<readonly CatalogCandidate[]>;
  getMarcMetadata(catalogKey: string): Promise<CatalogMetadata>;
  getHoldings(catalogKey: string): Promise<{
    readonly systemAvailable: number;
    readonly systemTotal: number;
    readonly branches: HoldingsView['branches'];
    readonly sourceUrl: string;
  }>;
}

export interface GenerateRecommendationsInput {
  readonly householdId: string;
  readonly personId: string;
  readonly allowedFormats?: readonly string[];
  readonly maxReadMinutes?: number;
  readonly maxPerAuthor?: number;
  readonly maxPerSubject?: number;
  readonly discoveryLimit?: number;
  readonly readAgainLimit?: number;
  readonly candidateHoldingsLimit?: number;
  readonly idFactory?: () => string;
  readonly now?: () => Date;
}

export async function generateRecommendations(
  database: Database,
  catalog: RecommendationCatalogPort,
  input: GenerateRecommendationsInput,
): Promise<RecommendationView> {
  const now = (input.now ?? (() => new Date()))();
  const idFactory = input.idFactory ?? (() => crypto.randomUUID());
  const features = await loadPreferenceFeatures(database, input.personId);
  const positive = features.filter(({ veto, preferenceScore }) => !veto && preferenceScore > 0);
  const seeds = recommendationSeeds(positive);
  const searchResults = new Map<string, CatalogCandidate>();
  for (const seed of seeds) {
    for (const candidate of await catalog.search(seed))
      searchResults.set(candidate.catalogKey, candidate);
  }

  const enrichedCandidates: RecommendationCandidate[] = [];
  for (const candidate of [...searchResults.values()].slice(0, 60)) {
    const metadata = await catalog.getMarcMetadata(candidate.catalogKey);
    enrichedCandidates.push({
      catalogKey: candidate.catalogKey,
      title: candidate.title,
      authors: candidate.authorDisplays,
      illustrators: metadata.contributors
        .filter(({ role }) => /illustrator/iu.test(role ?? ''))
        .map(({ name }) => name),
      series: metadata.series.map(({ name }) => name),
      subjects: metadata.subjects,
      genres: metadata.genres,
      format: candidate.format,
      juvenile: juvenile(metadata, candidate.juvenile),
      pageCount: metadata.pageCount,
    });
  }
  const constraints = {
    allowedFormats: input.allowedFormats ?? ['book', 'easy-reader'],
    maxReadMinutes: input.maxReadMinutes,
    maxPerAuthor: input.maxPerAuthor ?? 2,
    maxPerSubject: input.maxPerSubject ?? 3,
  };
  const discovery = scoreDiscoveryCandidates(features, enrichedCandidates, constraints, now).slice(
    0,
    input.candidateHoldingsLimit ?? 30,
  );
  const readAgain = positive
    .filter(({ catalogKeys }) => catalogKeys.length > 0)
    .sort(
      (left, right) =>
        right.preferenceScore - left.preferenceScore || left.workId.localeCompare(right.workId),
    )
    .slice(0, input.readAgainLimit ?? 6);

  const itemDrafts: Parameters<typeof saveRecommendationRun>[1]['items'][number][] = [];
  let discoveryRank = 0;
  for (const item of discovery.slice(0, input.discoveryLimit ?? 12)) {
    const holdings = await holdingsFor(database, catalog, item.candidate.catalogKey, now);
    discoveryRank += 1;
    itemDrafts.push({
      id: idFactory(),
      kind: 'discovery',
      rank: discoveryRank,
      catalogKey: item.candidate.catalogKey,
      title: item.candidate.title,
      authors: item.candidate.authors,
      score: item.score,
      evidence:
        item.evidence.length > 0 ? item.evidence : ['Matches the household preference profile'],
      components: item.components,
      estimatedReadMinutes: item.estimatedReadMinutes,
      metadata: item.candidate,
      holdingsObservedAt: holdings.fetchedAt,
    });
  }
  let readAgainRank = 0;
  for (const feature of readAgain) {
    const catalogKey = feature.catalogKeys[0];
    if (!catalogKey) continue;
    const holdings = await holdingsFor(database, catalog, catalogKey, now);
    readAgainRank += 1;
    itemDrafts.push({
      id: idFactory(),
      kind: 'read_again',
      rank: readAgainRank,
      catalogKey,
      workId: feature.workId,
      title: feature.title,
      authors: feature.authors,
      score: feature.preferenceScore,
      evidence: readAgainEvidence(feature),
      components: { preference: feature.preferenceScore },
      estimatedReadMinutes: feature.estimatedReadMinutes,
      metadata: feature,
      holdingsObservedAt: holdings.fetchedAt,
    });
  }
  await saveRecommendationRun(database, {
    id: idFactory(),
    householdId: input.householdId,
    personId: input.personId,
    constraints,
    seedCount: seeds.length,
    candidateCount: searchResults.size,
    generatedAt: now.toISOString(),
    items: itemDrafts,
  });
  return getRecommendations(database, input.personId);
}

interface PreferenceRow {
  readonly work_id: string;
  readonly title: string;
  readonly primary_author: string | null;
  readonly preference_score: number;
  readonly last_episode_at: string;
  readonly estimated_read_minutes: number | null;
  readonly adult_tolerance: number | null;
  readonly veto: number;
  readonly traits_json: string | null;
  readonly edition_id: string;
  readonly authors_json: string;
  readonly catalog_keys: string | null;
}

async function loadPreferenceFeatures(
  database: Database,
  personId: string,
): Promise<readonly PreferenceFeature[]> {
  const rows = await database.query<PreferenceRow>(
    `SELECT s.work_id, w.canonical_title AS title, w.primary_author, s.preference_score,
       max(ae.window_end) AS last_episode_at, wa.estimated_read_minutes, wa.adult_tolerance, coalesce(wa.veto, 0) AS veto,
       wa.traits_json, min(e.id) AS edition_id, min(e.authors_json) AS authors_json,
       group_concat(DISTINCT x.value) AS catalog_keys
     FROM preference_summaries s JOIN works w ON w.id = s.work_id
     JOIN acquisition_episodes ae ON ae.work_id = s.work_id AND ae.person_id = s.person_id
     JOIN editions e ON e.work_id = s.work_id
     LEFT JOIN work_assessments wa ON wa.work_id = s.work_id AND wa.person_id = s.person_id
     LEFT JOIN external_identifiers x ON x.entity_kind = 'edition' AND x.entity_id = e.id AND x.namespace = 'kcls-bibid'
     WHERE s.person_id = ? GROUP BY s.work_id ORDER BY s.preference_score DESC, s.work_id`,
    [personId],
  );
  const output: PreferenceFeature[] = [];
  for (const row of rows) {
    const metadata = await getEffectiveMetadata(database, 'edition', row.edition_id);
    const authorObjects = JSON.parse(row.authors_json) as readonly (
      { readonly display?: string } | string
    )[];
    output.push({
      workId: row.work_id,
      title: row.title,
      authors: authorObjects
        .map((author) => (typeof author === 'string' ? author : (author.display ?? '')))
        .filter(Boolean)
        .concat(row.primary_author && authorObjects.length === 0 ? [row.primary_author] : []),
      illustrators: (metadata.contributors ?? [])
        .filter(({ role }) => /illustrator/iu.test(role ?? ''))
        .map(({ name }) => name),
      series: (metadata.series ?? []).map(({ name }) => name),
      subjects: metadata.subjects ?? [],
      genres: metadata.genres ?? [],
      traits: JSON.parse(row.traits_json ?? '[]') as string[],
      preferenceScore: row.preference_score,
      lastEpisodeAt: row.last_episode_at,
      estimatedReadMinutes: row.estimated_read_minutes ?? undefined,
      adultTolerance: row.adult_tolerance ?? undefined,
      veto: row.veto === 1,
      catalogKeys: row.catalog_keys?.split(',').filter(Boolean) ?? [],
    });
  }
  return output;
}

function recommendationSeeds(features: readonly PreferenceFeature[]): readonly string[] {
  const seeds = features.flatMap((feature) => [
    ...feature.series.map((value) => `series "${value}" juvenile`),
    ...feature.authors.map((value) => `author "${value}" juvenile`),
    ...feature.illustrators.map((value) => `author "${value}" picture book`),
    ...feature.subjects.map((value) => `subject "${value}" juvenile`),
    ...feature.genres.map((value) => `genre "${value}" juvenile`),
  ]);
  return [...new Set(seeds)].slice(0, 12);
}

function juvenile(metadata: CatalogMetadata, catalogHint: boolean | undefined): boolean {
  return (
    catalogHint === true ||
    metadata.juvenileHeading ||
    ['a', 'b', 'c', 'j'].includes(metadata.audience ?? '') ||
    metadata.genres.some((value) => /picture books|juvenile/iu.test(value))
  );
}

async function holdingsFor(
  database: Database,
  catalog: RecommendationCatalogPort,
  catalogKey: string,
  now: Date,
): Promise<HoldingsView> {
  const cached = await getFreshHoldings(database, catalogKey, now);
  if (cached) return cached;
  const fetched = await catalog.getHoldings(catalogKey);
  const holdings: HoldingsView = {
    ...fetched,
    catalogKey,
    fetchedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
  await saveHoldings(database, holdings);
  return holdings;
}

function readAgainEvidence(feature: PreferenceFeature): readonly string[] {
  const evidence = [`Strong household preference score (${feature.preferenceScore.toFixed(1)})`];
  if (feature.traits.length > 0)
    evidence.push(`Known read-aloud fit: ${feature.traits.join(', ')}`);
  return evidence;
}
