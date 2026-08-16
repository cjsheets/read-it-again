import { load } from 'cheerio';

export interface BibliocommonsAuthor {
  readonly family: string;
  readonly given?: string;
  readonly display: string;
  readonly raw: string;
}

export interface BibliocommonsRow {
  readonly title: string;
  readonly subtitle?: string;
  readonly authors: readonly BibliocommonsAuthor[];
  readonly sourceFormat: string;
  readonly publishedYear?: number;
  readonly callNumber: string;
  readonly occurredAt: string;
  readonly rawPayload: {
    readonly title: string;
    readonly subtitle?: string;
    readonly author: string;
    readonly format: string;
    readonly publishedYear?: number;
    readonly callNumber: string;
    readonly checkedOutDate: string;
  };
}

export interface BibliocommonsParseResult {
  readonly rowsSeen: number;
  readonly records: readonly BibliocommonsRow[];
}

export class BibliocommonsSnapshotError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`BiblioCommons snapshot is invalid: ${issues.join('; ')}`);
    this.name = 'BibliocommonsSnapshotError';
  }
}

const REQUIRED_SELECTORS = [
  'td.item-title p.main-title',
  'td.item-format',
  'td.item-callnumber p.callnumber-details',
  'td.item-checkedoutdate',
] as const;

export function parseBibliocommonsSnapshot(rawHtml: string): BibliocommonsParseResult {
  const $ = load(rawHtml);
  const rows = $('tr').filter((_, row) => $(row).find('td.item-title').length > 0);
  if (rows.length === 0) {
    throw new BibliocommonsSnapshotError(['no recently-returned rows were found']);
  }

  const records: BibliocommonsRow[] = [];
  const issues: string[] = [];
  rows.each((index, row) => {
    const missing = REQUIRED_SELECTORS.filter(
      (selector) => cleanText($(row).find(selector).first().text()).length === 0,
    );
    if (missing.length > 0) {
      issues.push(`row ${index + 1} is missing ${missing.join(', ')}`);
      return;
    }

    const title = cleanText($(row).find('td.item-title p.main-title').first().text());
    const subtitle =
      cleanText($(row).find('td.item-title p.sub-title').first().text()) || undefined;
    const rawAuthor = cleanText($(row).find('td.item-author').first().text());
    const formatCell = $(row).find('td.item-format').first().clone();
    const yearText = cleanText(formatCell.find('span.publication-date').first().text());
    formatCell.find('span.publication-date').remove();
    const sourceFormat = cleanText(formatCell.text());
    const publishedYear = parseYear(yearText, index, issues);
    const callNumber = cleanText(
      $(row).find('td.item-callnumber p.callnumber-details').first().text(),
    );
    const checkedOutDate = cleanText($(row).find('td.item-checkedoutdate').first().text());
    const occurredAt = parseDate(checkedOutDate, index, issues);
    if (!occurredAt) return;

    records.push({
      title,
      subtitle,
      authors: rawAuthor ? [parseFamilyFirstAuthor(rawAuthor)] : [],
      sourceFormat,
      publishedYear,
      callNumber,
      occurredAt,
      rawPayload: {
        title,
        subtitle,
        author: rawAuthor,
        format: sourceFormat,
        publishedYear,
        callNumber,
        checkedOutDate,
      },
    });
  });

  if (issues.length > 0) throw new BibliocommonsSnapshotError(issues);
  return { rowsSeen: rows.length, records };
}

function cleanText(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim();
}

function parseFamilyFirstAuthor(raw: string): BibliocommonsAuthor {
  const comma = raw.indexOf(',');
  if (comma < 0) return { family: raw, display: raw, raw };
  const family = raw.slice(0, comma).trim();
  const given = raw.slice(comma + 1).trim() || undefined;
  return { family, given, display: given ? `${given} ${family}` : family, raw };
}

function parseYear(value: string, rowIndex: number, issues: string[]): number | undefined {
  if (!value) return undefined;
  const match = /^(?:,\s*)?(\d{4})$/u.exec(value);
  if (!match) {
    issues.push(`row ${rowIndex + 1} has invalid publication year ${JSON.stringify(value)}`);
    return undefined;
  }
  return Number(match[1]);
}

function parseDate(value: string, rowIndex: number, issues: string[]): string | undefined {
  const numeric = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/u.exec(value);
  const named = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})$/u.exec(
    value,
  );
  if (!numeric && !named) {
    issues.push(`row ${rowIndex + 1} has invalid checkout date ${JSON.stringify(value)}`);
    return undefined;
  }
  const month = numeric ? Number(numeric[1]) : MONTHS.indexOf(named?.[1] ?? '') + 1;
  const day = Number((numeric ?? named)?.[2]);
  const year = Number((numeric ?? named)?.[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    issues.push(`row ${rowIndex + 1} has invalid checkout date ${JSON.stringify(value)}`);
    return undefined;
  }
  return date.toISOString();
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
