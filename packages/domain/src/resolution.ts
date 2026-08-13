import { canonicalAuthor, canonicalIsbn, normalizeFormat, tokenizeTitle } from './normalization.js';

export interface ResolutionInput {
  readonly title: string;
  readonly authorDisplays: readonly string[];
  readonly isbn?: string;
  readonly format?: string;
  readonly publishedYear?: number;
  readonly juvenileHint?: boolean;
}

export interface CatalogCandidate {
  readonly catalogKey: string;
  readonly title: string;
  readonly authorDisplays: readonly string[];
  readonly isbns: readonly string[];
  readonly format?: string;
  readonly publishedYear?: number;
  readonly juvenile?: boolean;
  readonly summary?: string;
}

export interface CandidateScore {
  readonly total: number;
  readonly title: number;
  readonly author: number;
  readonly isbn: number;
  readonly format: number;
  readonly year: number;
  readonly audience: number;
}

export interface ResolutionRanking {
  readonly candidate: CatalogCandidate;
  readonly score: CandidateScore;
  readonly rank: number;
  readonly margin: number;
  readonly automatic: boolean;
}

export function scoreCandidate(
  input: ResolutionInput,
  candidate: CatalogCandidate,
): CandidateScore {
  const title = tokenSetSimilarity(tokenizeTitle(input.title), tokenizeTitle(candidate.title));
  const inputAuthors = input.authorDisplays.map(canonicalAuthor);
  const candidateAuthors = candidate.authorDisplays.map(canonicalAuthor);
  const author = bestSimilarity(inputAuthors, candidateAuthors, authorSimilarity);
  const inputIsbn = canonicalIsbn(input.isbn);
  const candidateIsbns = new Set(candidate.isbns.map(canonicalIsbn).filter(Boolean));
  const isbn = inputIsbn && candidateIsbns.has(inputIsbn) ? 1 : 0;
  const inputFormat = normalizeFormat(input.format);
  const candidateFormat = normalizeFormat(candidate.format);
  const format =
    inputFormat && candidateFormat ? formatCompatibility(inputFormat, candidateFormat) : 0.5;
  const year = yearSimilarity(input.publishedYear, candidate.publishedYear);
  const audience =
    input.juvenileHint === undefined || candidate.juvenile === undefined
      ? 0.5
      : input.juvenileHint === candidate.juvenile
        ? 1
        : 0;

  // ISBN is decisive when present; otherwise title and author dominate.
  const total =
    isbn === 1
      ? 0.97 + 0.02 * title + 0.01 * author
      : 0.5 * title + 0.28 * author + 0.1 * format + 0.07 * year + 0.05 * audience;
  return roundScore({ total, title, author, isbn, format, year, audience });
}

export function rankCandidates(
  input: ResolutionInput,
  candidates: readonly CatalogCandidate[],
): readonly ResolutionRanking[] {
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(input, candidate) }))
    .sort(
      (left, right) =>
        right.score.total - left.score.total ||
        left.candidate.catalogKey.localeCompare(right.candidate.catalogKey),
    );

  return scored.map((entry, index) => {
    const runnerUp = scored[index + 1]?.score.total ?? 0;
    const margin = Number((entry.score.total - runnerUp).toFixed(4));
    return {
      ...entry,
      rank: index + 1,
      margin,
      automatic: index === 0 && entry.score.total >= 0.85 && margin >= 0.15,
    };
  });
}

function tokenSetSimilarity(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left);
  const b = new Set(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function authorSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  const leftParts = left.split(' ');
  const rightParts = right.split(' ');
  const leftFamily = leftParts[0] ?? '';
  const rightFamily = rightParts[0] ?? '';
  if (leftFamily !== rightFamily) return 0;
  const leftInitial = leftParts[1]?.[0];
  const rightInitial = rightParts[1]?.[0];
  return leftInitial && rightInitial && leftInitial === rightInitial ? 0.9 : 0.75;
}

function bestSimilarity(
  left: readonly string[],
  right: readonly string[],
  compare: (left: string, right: string) => number,
): number {
  return Math.max(0, ...left.flatMap((a) => right.map((b) => compare(a, b))));
}

function formatCompatibility(left: string, right: string): number {
  if (left === right) return 1;
  const digital = new Set(['ebook', 'audiobook']);
  return digital.has(left) === digital.has(right) ? 0.65 : 0;
}

function yearSimilarity(left: number | undefined, right: number | undefined): number {
  if (left === undefined || right === undefined) return 0.5;
  const distance = Math.abs(left - right);
  return distance === 0 ? 1 : distance <= 2 ? 0.8 : distance <= 10 ? 0.4 : 0;
}

function roundScore(score: CandidateScore): CandidateScore {
  return {
    total: Number(score.total.toFixed(4)),
    title: Number(score.title.toFixed(4)),
    author: Number(score.author.toFixed(4)),
    isbn: Number(score.isbn.toFixed(4)),
    format: Number(score.format.toFixed(4)),
    year: Number(score.year.toFixed(4)),
    audience: Number(score.audience.toFixed(4)),
  };
}
