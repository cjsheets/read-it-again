import type { NormalizedImportRecord } from '@read-it-again/storage-schema';

export interface CsvColumnMapping {
  readonly title: string;
  readonly author?: string;
  readonly isbn?: string;
  readonly date?: string;
  readonly format?: string;
}

export interface CsvParseResult {
  readonly rowsSeen: number;
  readonly rowsIgnored: number;
  readonly records: readonly NormalizedImportRecord[];
}

export class CsvImportError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`CSV snapshot is invalid: ${issues.join('; ')}`);
    this.name = 'CsvImportError';
  }
}

export function parseCsvSnapshot(rawText: string, mapping?: CsvColumnMapping): CsvParseResult {
  const rows = parseRows(rawText);
  const headers = rows[0]?.map((value) => value.trim()) ?? [];
  if (headers.length === 0) throw new CsvImportError(['The file has no header row']);
  const resolved = mapping ?? inferMapping(headers);
  const titleIndex = columnIndex(headers, resolved.title);
  const authorIndex = optionalColumnIndex(headers, resolved.author);
  const isbnIndex = optionalColumnIndex(headers, resolved.isbn);
  const dateIndex = optionalColumnIndex(headers, resolved.date);
  const formatIndex = optionalColumnIndex(headers, resolved.format);
  const issues: string[] = [];
  const records: NormalizedImportRecord[] = [];
  rows.slice(1).forEach((row, index) => {
    if (row.every((value) => !value.trim())) return;
    const title = row[titleIndex]?.trim();
    if (!title) {
      issues.push(`Row ${index + 2}: title is required`);
      return;
    }
    const author = authorIndex === undefined ? '' : (row[authorIndex]?.trim() ?? '');
    const isbn = isbnIndex === undefined ? undefined : normalizeIsbn(row[isbnIndex]);
    const occurredAt = parseDate(dateIndex === undefined ? undefined : row[dateIndex], index + 2);
    const sourceFormat =
      formatIndex === undefined ? undefined : row[formatIndex]?.trim() || undefined;
    const raw = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']));
    records.push({
      sourceKey: `csv:v1:${stableKey([title, author, isbn ?? '', occurredAt, sourceFormat ?? ''])}`,
      normalizationVersion: 1,
      rawPayloadJson: JSON.stringify(raw),
      title,
      authorsJson: JSON.stringify(
        author
          ? [{ display: author, raw: author, family: author.split(/\s+/u).at(-1) ?? author }]
          : [],
      ),
      isbn,
      sourceFormat,
      occurredAt,
    });
  });
  if (issues.length > 0) throw new CsvImportError(issues.slice(0, 20));
  return {
    rowsSeen: Math.max(0, rows.length - 1),
    rowsIgnored: Math.max(0, rows.length - 1 - records.length),
    records,
  };
}

function inferMapping(headers: readonly string[]): CsvColumnMapping {
  const find = (...aliases: readonly string[]) =>
    headers.find((header) => aliases.includes(normalize(header)));
  const title = find('title', 'book title', 'name');
  if (!title)
    throw new CsvImportError([
      `Could not find a title column. Available columns: ${headers.join(', ')}`,
    ]);
  return {
    title,
    author: find('author', 'authors', 'author name'),
    isbn: find('isbn', 'isbn13', 'isbn 13', 'isbn10'),
    date: find('date', 'read date', 'date read', 'checkout date', 'borrowed at'),
    format: find('format', 'binding', 'media type'),
  };
}

function parseRows(value: string): readonly string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      if (quoted && value[index + 1] === '"') {
        field += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && value[index + 1] === '\n') index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }
  if (quoted) throw new CsvImportError(['An quoted field is not closed']);
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function columnIndex(headers: readonly string[], name: string): number {
  const index = headers.indexOf(name);
  if (index < 0) throw new CsvImportError([`Mapped column “${name}” does not exist`]);
  return index;
}
function optionalColumnIndex(
  headers: readonly string[],
  name: string | undefined,
): number | undefined {
  return name ? columnIndex(headers, name) : undefined;
}
function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('en-US').replaceAll(/[_-]+/gu, ' ');
}
function normalizeIsbn(value: string | undefined): string | undefined {
  const result = value?.toUpperCase().replaceAll(/[^0-9X]/gu, '');
  return result || undefined;
}
function parseDate(value: string | undefined, row: number): string {
  if (!value?.trim()) return new Date(0).toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new CsvImportError([`Row ${row}: date is invalid`]);
  return date.toISOString();
}
function stableKey(values: readonly string[]): string {
  return values
    .map((value) => encodeURIComponent(value.trim().toLocaleLowerCase('en-US')))
    .join(':');
}
