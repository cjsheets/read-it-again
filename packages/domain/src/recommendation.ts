export interface PreferenceFeature {
  readonly workId: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly illustrators: readonly string[];
  readonly series: readonly string[];
  readonly subjects: readonly string[];
  readonly genres: readonly string[];
  readonly traits: readonly string[];
  readonly preferenceScore: number;
  readonly lastEpisodeAt: string;
  readonly estimatedReadMinutes?: number;
  readonly adultTolerance?: number;
  readonly veto: boolean;
  readonly catalogKeys: readonly string[];
}

export interface RecommendationCandidate {
  readonly catalogKey: string;
  readonly title: string;
  readonly authors: readonly string[];
  readonly illustrators: readonly string[];
  readonly series: readonly string[];
  readonly subjects: readonly string[];
  readonly genres: readonly string[];
  readonly format?: string;
  readonly juvenile: boolean;
  readonly pageCount?: number;
}

export interface RecommendationConstraints {
  readonly allowedFormats: readonly string[];
  readonly maxReadMinutes?: number;
  readonly maxPerAuthor: number;
  readonly maxPerSubject: number;
}

export interface ScoredRecommendation {
  readonly candidate: RecommendationCandidate;
  readonly score: number;
  readonly estimatedReadMinutes?: number;
  readonly evidence: readonly string[];
  readonly components: Readonly<Record<string, number>>;
}

export function scoreDiscoveryCandidates(
  features: readonly PreferenceFeature[],
  candidates: readonly RecommendationCandidate[],
  constraints: RecommendationConstraints,
  asOf: Date = new Date(),
): readonly ScoredRecommendation[] {
  const positive = features.filter((feature) => !feature.veto && feature.preferenceScore > 0);
  const knownKeys = new Set(features.flatMap(({ catalogKeys }) => catalogKeys));
  const knownShapes = new Set(features.map(workShape));
  const vetoAuthors = new Set(
    features.filter(({ veto }) => veto).flatMap(({ authors }) => authors.map(normalize)),
  );
  const profile = weightedProfile(positive, asOf);
  const scored = candidates
    .filter((candidate) => candidate.juvenile)
    .filter((candidate) => !knownKeys.has(candidate.catalogKey))
    .filter((candidate) => !knownShapes.has(workShape(candidate)))
    .filter(
      (candidate) =>
        !candidate.format ||
        constraints.allowedFormats.length === 0 ||
        constraints.allowedFormats.includes(normalize(candidate.format)),
    )
    .filter((candidate) => !candidate.authors.some((author) => vetoAuthors.has(normalize(author))))
    .map((candidate) => scoreOne(candidate, profile, constraints.maxReadMinutes))
    .filter((candidate) => candidate.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.catalogKey.localeCompare(right.candidate.catalogKey),
    );

  const authorCounts = new Map<string, number>();
  const subjectCounts = new Map<string, number>();
  return scored.filter(({ candidate }) => {
    const author = normalize(candidate.authors[0] ?? 'unknown');
    const subject = normalize(candidate.subjects[0] ?? candidate.genres[0] ?? 'uncategorized');
    const authorCount = authorCounts.get(author) ?? 0;
    const subjectCount = subjectCounts.get(subject) ?? 0;
    if (authorCount >= constraints.maxPerAuthor || subjectCount >= constraints.maxPerSubject)
      return false;
    authorCounts.set(author, authorCount + 1);
    subjectCounts.set(subject, subjectCount + 1);
    return true;
  });
}

interface Profile {
  readonly authors: ReadonlyMap<string, number>;
  readonly illustrators: ReadonlyMap<string, number>;
  readonly series: ReadonlyMap<string, number>;
  readonly subjects: ReadonlyMap<string, number>;
  readonly genres: ReadonlyMap<string, number>;
  readonly traits: ReadonlyMap<string, number>;
}

function weightedProfile(features: readonly PreferenceFeature[], asOf: Date): Profile {
  const profile = {
    authors: new Map<string, number>(),
    illustrators: new Map<string, number>(),
    series: new Map<string, number>(),
    subjects: new Map<string, number>(),
    genres: new Map<string, number>(),
    traits: new Map<string, number>(),
  };
  for (const feature of features) {
    const recency = recencyWeight(feature.lastEpisodeAt, asOf);
    const tolerance = feature.adultTolerance === undefined ? 1 : 0.5 + feature.adultTolerance / 6;
    const weight = Math.max(0.25, feature.preferenceScore) * recency * tolerance;
    add(profile.authors, feature.authors, weight);
    add(profile.illustrators, feature.illustrators, weight);
    add(profile.series, feature.series, weight);
    add(profile.subjects, feature.subjects, weight);
    add(profile.genres, feature.genres, weight);
    add(profile.traits, feature.traits, weight);
  }
  return profile;
}

function scoreOne(
  candidate: RecommendationCandidate,
  profile: Profile,
  maxReadMinutes: number | undefined,
): ScoredRecommendation {
  const author = best(profile.authors, candidate.authors) * 2.5;
  const illustrator = best(profile.illustrators, candidate.illustrators) * 2.25;
  const series = best(profile.series, candidate.series) * 3;
  const subject = average(profile.subjects, candidate.subjects) * 1.5;
  const genre = average(profile.genres, candidate.genres) * 1.25;
  const inferredTraits = inferTraits(candidate);
  const trait = average(profile.traits, inferredTraits) * 0.75;
  const estimatedReadMinutes = candidate.pageCount
    ? Math.max(3, Math.round(candidate.pageCount / 4))
    : undefined;
  const duration =
    maxReadMinutes && estimatedReadMinutes
      ? estimatedReadMinutes <= maxReadMinutes
        ? 0.5
        : -2
      : 0;
  const components = { series, author, illustrator, subject, genre, trait, duration };
  const evidence: string[] = [];
  if (series > 0)
    evidence.push(`Continues a favored series (${matching(candidate.series, profile.series)})`);
  if (author > 0)
    evidence.push(`By a favored author (${matching(candidate.authors, profile.authors)})`);
  if (illustrator > 0)
    evidence.push(
      `Illustrated by a household favorite (${matching(candidate.illustrators, profile.illustrators)})`,
    );
  if (subject > 0)
    evidence.push(
      `Matches favored subjects (${matches(candidate.subjects, profile.subjects).join(', ')})`,
    );
  if (genre > 0)
    evidence.push(
      `Matches favored genres (${matches(candidate.genres, profile.genres).join(', ')})`,
    );
  if (trait > 0)
    evidence.push(`Likely trait match (${matches(inferredTraits, profile.traits).join(', ')})`);
  if (duration > 0)
    evidence.push(`Estimated ${estimatedReadMinutes} minutes fits the selected limit`);
  return {
    candidate,
    score: round(Object.values(components).reduce((sum, value) => sum + value, 0)),
    estimatedReadMinutes,
    evidence,
    components: Object.fromEntries(
      Object.entries(components).map(([key, value]) => [key, round(value)]),
    ),
  };
}

function inferTraits(candidate: RecommendationCandidate): readonly string[] {
  const text = [...candidate.subjects, ...candidate.genres].join(' ').toLocaleLowerCase('en-US');
  return [
    ...(text.includes('stories in rhyme') || text.includes('poetry') ? ['rhyme_meter'] : []),
    ...(text.includes('humor') || text.includes('humorous') ? ['humor'] : []),
    ...(text.includes('interactive') || text.includes('games') ? ['interactive'] : []),
    ...(text.includes('picture books') ? ['illustration_led'] : []),
  ];
}

function recencyWeight(value: string, asOf: Date): number {
  const ageDays = Math.max(0, (asOf.getTime() - new Date(value).getTime()) / 86_400_000);
  return Math.max(0.25, 0.5 ** (ageDays / 274));
}

function add(target: Map<string, number>, values: readonly string[], weight: number): void {
  for (const value of values) {
    const key = normalize(value);
    target.set(key, (target.get(key) ?? 0) + weight);
  }
}

function best(profile: ReadonlyMap<string, number>, values: readonly string[]): number {
  return Math.max(0, ...values.map((value) => profile.get(normalize(value)) ?? 0));
}

function average(profile: ReadonlyMap<string, number>, values: readonly string[]): number {
  const hits = values
    .map((value) => profile.get(normalize(value)) ?? 0)
    .filter((value) => value > 0);
  return hits.length === 0 ? 0 : hits.reduce((sum, value) => sum + value, 0) / hits.length;
}

function matches(
  values: readonly string[],
  profile: ReadonlyMap<string, number>,
): readonly string[] {
  return values.filter((value) => profile.has(normalize(value))).slice(0, 3);
}

function matching(values: readonly string[], profile: ReadonlyMap<string, number>): string {
  return matches(values, profile)[0] ?? values[0] ?? 'catalog match';
}

function workShape(value: { readonly title: string; readonly authors: readonly string[] }): string {
  return `${normalize(value.title)}::${normalize(value.authors[0] ?? '')}`;
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .toLocaleLowerCase('en-US');
}

function round(value: number): number {
  return Number(value.toFixed(4));
}
