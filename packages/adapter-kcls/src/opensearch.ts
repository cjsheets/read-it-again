import type { CatalogCandidate } from '@read-it-again/domain';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
});

export function parseOpenSearch(xml: string): readonly CatalogCandidate[] {
  const document = parser.parse(xml) as Record<string, unknown>;
  const feed = asObject(document.feed);
  const entries = asArray(feed?.entry);
  return entries.map(parseEntry).filter((entry): entry is CatalogCandidate => entry !== undefined);
}

function parseEntry(raw: unknown): CatalogCandidate | undefined {
  const entry = asObject(raw);
  if (!entry) return undefined;
  const title = text(entry.title)
    .replace(/\s*\/\s*$/u, '')
    .trim();
  const id = text(entry.id);
  const identifiers = asArray(entry.identifier).map(text).filter(Boolean);
  const catalogKey = bibId(id, entry, identifiers);
  if (!title || !catalogKey) return undefined;

  const categories = asArray(entry.category)
    .map(asObject)
    .filter((value): value is Record<string, unknown> => value !== undefined)
    .map((category) => stringValue(category['@_term']) ?? stringValue(category['@_label']) ?? '');
  const isbns = [...categories, ...identifiers].flatMap((identifier) => {
    const match = identifier.match(/(?:isbn[:/]?)([0-9X-]{10,20})/iu);
    return match?.[1] ? [match[1].replaceAll('-', '')] : [];
  });

  const authors = extractAuthors(entry);
  const summary = text(entry.summary) || text(entry.content) || undefined;
  const publishedYear = extractYear(summary);
  const categoryText = categories.join(' ').toLocaleLowerCase('en-US');
  return {
    catalogKey,
    title,
    authorDisplays: authors,
    isbns,
    format: inferFormat(categoryText),
    publishedYear,
    juvenile: /juvenile|picture book|easy reader/u.test(categoryText) || undefined,
    summary,
  };
}

function extractAuthors(entry: Record<string, unknown>): readonly string[] {
  return asArray(entry.author)
    .map(asObject)
    .map((author) => cleanContributor(text(author?.name)))
    .filter(Boolean);
}

function bibId(
  id: string,
  entry: Record<string, unknown>,
  identifiers: readonly string[],
): string | undefined {
  const direct = id.match(/biblio-record_entry\/(\d+)/u)?.[1] ?? id.match(/bibid[:/]?(\d+)/iu)?.[1];
  if (direct) return direct;
  for (const identifier of identifiers) {
    const match = identifier.match(/bibid[:/]?(\d+)/iu);
    if (match?.[1]) return match[1];
  }
  for (const category of asArray(entry.category)) {
    const term = stringValue(asObject(category)?.['@_term']) ?? '';
    const match = term.match(/bibid[:/]?(\d+)/iu);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

function inferFormat(categories: string): string | undefined {
  if (categories.includes('audiobook')) return 'audiobook';
  if (categories.includes('ebook') || categories.includes('electronic resource')) return 'ebook';
  if (categories.includes('easy reader')) return 'easy-reader';
  if (categories.includes('book')) return 'book';
  return undefined;
}

function extractYear(...values: readonly (string | undefined)[]): number | undefined {
  for (const value of values) {
    const match = value?.match(/\b(19|20)\d{2}\b/u);
    if (match) return Number(match[0]);
  }
  return undefined;
}

function text(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map(text).filter(Boolean).at(-1) ?? '';
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return decodeNumericEntities(String(value)).trim();
  }
  const object = asObject(value);
  return typeof object?.['#text'] === 'string' ? decodeNumericEntities(object['#text']).trim() : '';
}

function cleanContributor(value: string): string {
  return value
    .replace(/^880-\d+\s*/u, '')
    .replace(/,(?:author|illustrator|translator|editor|narrator)\..*$/iu, '')
    .trim();
}

function decodeNumericEntities(value: string): string {
  return value
    .replaceAll(/&#x([0-9a-f]+);/giu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 16)),
    )
    .replaceAll(/&#([0-9]+);/gu, (_, digits: string) =>
      String.fromCodePoint(Number.parseInt(digits, 10)),
    );
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): readonly unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}
