#!/usr/bin/env node

/**
 * R4 kill-gate audit. This is measurement tooling, not product code.
 *
 * The fallback corpus deliberately samples published bestseller lists. That is
 * an optimistic upper bound for a real family shelf: current, popular editions
 * are more likely to be catalogued than board books, hand-me-downs and older
 * printings. Do not generalize this result beyond the gate it measures.
 *
 * Open Library's legacy Books API accepts several bibkeys in one request. Ten
 * ISBNs per request keeps the per-edition answer while avoiding a hundred
 * separate calls. Requests remain below the anonymous one-request-per-second
 * limit documented at https://openlibrary.org/developers/api.
 */

const TARGET_SIZE = 100;
const BATCH_SIZE = 10;
const REQUEST_INTERVAL_MS = 1_100;
const SOURCE_URLS = [
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20240115.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20240415.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20240715.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20241014.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20250113.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20250414.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20250714.html',
  'https://www.publishersweekly.com/pw/nielsen/kidspicture/20251013.html',
];

const corpusOnly = process.argv.includes('--corpus-only');
const corpus = (await loadCorpus()).slice(0, TARGET_SIZE);
if (corpus.length < TARGET_SIZE) {
  throw new Error(`Expected ${TARGET_SIZE} unique bestseller ISBNs, found ${corpus.length}`);
}

if (corpusOnly) {
  console.log(
    JSON.stringify({ corpusLabel: corpusLabel(), sources: SOURCE_URLS, corpus }, null, 2),
  );
  process.exit(0);
}

const results = [];
for (let offset = 0; offset < corpus.length; offset += BATCH_SIZE) {
  const batch = corpus.slice(offset, offset + BATCH_SIZE);
  const url = new URL('https://openlibrary.org/api/books');
  url.searchParams.set('bibkeys', batch.map(({ isbn }) => `ISBN:${isbn}`).join(','));
  url.searchParams.set('format', 'json');
  url.searchParams.set('jscmd', 'data');
  const response = await fetchJson(url);

  for (const expected of batch) {
    const book = response[`ISBN:${expected.isbn}`];
    const returnedTitle = text(book?.title);
    const authors = Array.isArray(book?.authors)
      ? book.authors.map(({ name }) => text(name)).filter(Boolean)
      : [];
    results.push({
      ...expected,
      hit: book !== undefined,
      returnedTitle,
      authors,
      recognizableTitle: returnedTitle ? recognizableTitle(expected.title, returnedTitle) : false,
    });
  }

  if (offset + BATCH_SIZE < corpus.length) await delay(REQUEST_INTERVAL_MS);
}

const total = results.length;
const hits = results.filter(({ hit }) => hit).length;
const titles = results.filter(({ returnedTitle }) => returnedTitle).length;
const authors = results.filter((result) => result.authors.length > 0).length;
const recognizableTitles = results.filter(({ recognizableTitle }) => recognizableTitle).length;
const percent = (count) => Number(((count / total) * 100).toFixed(1));
const threshold = 70;
const report = {
  measuredAt: new Date().toISOString(),
  corpusLabel: corpusLabel(),
  caveat:
    'Optimistic upper bound: published bestsellers overstate coverage for real household shelves, especially board books and older editions.',
  endpoint: 'https://openlibrary.org/api/books?bibkeys=ISBN:{isbn}&format=json&jscmd=data',
  requestShape: `${Math.ceil(total / BATCH_SIZE)} requests of at most ${BATCH_SIZE} bibkeys`,
  sources: SOURCE_URLS,
  total,
  counts: { hits, titles, authors, recognizableTitles },
  percentages: {
    hitRate: percent(hits),
    titleRate: percent(titles),
    authorRate: percent(authors),
    recognizableTitleRate: percent(recognizableTitles),
  },
  recognizableTitleRule:
    'Case/punctuation-insensitive equality, one normalized title containing the other, or at least 70% shared normalized title tokens.',
  gate: {
    thresholdPercent: threshold,
    usableTitlePercent: percent(recognizableTitles),
    decision: percent(recognizableTitles) >= threshold ? 'proceed-to-r5' : 'kill-r5',
  },
  exceptions: results.filter(({ hit, recognizableTitle }) => !hit || !recognizableTitle),
};

console.log(JSON.stringify(report, null, 2));

async function loadCorpus() {
  const pages = [];
  for (const url of SOURCE_URLS) pages.push({ url, html: await fetchText(url) });
  const unique = new Map();
  for (const { url, html } of pages) {
    for (const entry of parseBestsellers(html, url)) {
      if (!unique.has(entry.isbn)) unique.set(entry.isbn, entry);
    }
  }
  return [...unique.values()];
}

function parseBestsellers(html, source) {
  const entries = [];
  const pattern =
    /<div class="nielsen-booktitle">([\s\S]*?)<\/div>[\s\S]*?<div class="nielsen-isbn">[\s\S]*?<br>\s*([0-9Xx-]{10,20})/gu;
  for (const match of html.matchAll(pattern)) {
    const title = decodeHtml(match[1].replaceAll(/<[^>]+>/gu, ''))
      .replaceAll(/\s+/gu, ' ')
      .trim();
    const isbn = match[2].replaceAll(/[^0-9Xx]/gu, '').toUpperCase();
    if (title && /^(?:97[89])?\d{9}[\dX]$/u.test(isbn)) entries.push({ isbn, title, source });
  }
  return entries;
}

function recognizableTitle(expected, actual) {
  const left = normalizeTitle(expected);
  const right = normalizeTitle(actual);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftTokens = new Set(left.split(' '));
  const rightTokens = new Set(right.split(' '));
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return shared / Math.max(leftTokens.size, rightTokens.size) >= 0.7;
}

function normalizeTitle(value) {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replaceAll('&', ' and ')
    .replaceAll(/[^a-z0-9]+/gu, ' ')
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

function decodeHtml(value) {
  const named = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' };
  return value.replaceAll(/&(#x[\da-f]+|#\d+|[a-z]+);/giu, (_entity, code) => {
    if (code.startsWith('#x')) return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
    if (code.startsWith('#')) return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
    return named[code.toLocaleLowerCase('en-US')] ?? `&${code};`;
  });
}

async function fetchText(url) {
  const response = await fetchWithRetry(url);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetchWithRetry(url);
  return response.json();
}

async function fetchWithRetry(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Read-It-Again-R4-Coverage-Audit/1.0' },
        signal: AbortSignal.timeout(30_000),
      });
      if (response.ok) return response;
      lastError = new Error(`${response.status} ${response.statusText} from ${url}`);
      if (response.status !== 429 && response.status < 500) throw lastError;
    } catch (error) {
      lastError = error;
    }
    await delay(attempt * 2_000);
  }
  throw lastError;
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function corpusLabel() {
  return 'Publishers Weekly Children’s Picture Books bestseller fallback, eight seasonal lists from 2024–2025';
}
