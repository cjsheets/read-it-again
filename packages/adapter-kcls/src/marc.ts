import { XMLParser } from 'fast-xml-parser';
import type { CatalogMetadata, MarcContributor, MarcSeries } from '@read-it-again/domain';

interface MarcSubfield {
  readonly '@_code'?: string;
  readonly '#text'?: string | number;
}

interface MarcField {
  readonly '@_tag'?: string;
  readonly subfield?: MarcSubfield | readonly MarcSubfield[];
}

interface MarcControlField {
  readonly '@_tag'?: string;
  readonly '#text'?: string;
}

export function parseMarcMetadata(xml: string): CatalogMetadata {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const document = parser.parse(xml) as {
    record?: {
      controlfield?: MarcControlField | readonly MarcControlField[];
      datafield?: MarcField | readonly MarcField[];
    };
  };
  if (!document.record) throw new Error('KCLS MARC response does not contain a record');
  const controls = array(document.record.controlfield);
  const fields = array(document.record.datafield);
  const fixed = controls.find((field) => field['@_tag'] === '008')?.['#text'] ?? '';
  const audience = fixed.length > 22 ? fixed[22]?.trim() || undefined : undefined;
  const subjects = fields
    .filter((field) => field['@_tag'] === '650')
    .map((field) => joinSubfields(field, ['a', 'x', 'v', 'y', 'z']))
    .filter(Boolean);
  const genres = fields
    .filter((field) => field['@_tag'] === '655')
    .map((field) => joinSubfields(field, ['a', 'v']))
    .filter(Boolean);
  const contributors = fields
    .filter((field) => field['@_tag'] === '700')
    .map(parseContributor)
    .filter((value): value is MarcContributor => value !== undefined);
  const extent = firstSubfield(fields, '300', 'a');
  const pageCountMatch = extent ? /(\d+)\s*(?:pages|p\.)/iu.exec(extent) : undefined;
  const callNumber = firstSubfield(fields, '092', 'a') ?? firstSubfield(fields, '082', 'a');
  const summary = firstSubfield(fields, '520', 'a');
  const series = [
    ...fields.filter((field) => field['@_tag'] === '490'),
    ...fields.filter((field) => field['@_tag'] === '800'),
  ]
    .map(parseSeries)
    .filter((value): value is MarcSeries => value !== undefined);
  return {
    audience,
    juvenileHeading: subjects.some((value) => /juvenile/iu.test(value)),
    subjects,
    genres,
    contributors,
    pageCount: pageCountMatch ? Number(pageCountMatch[1]) : undefined,
    callNumber: clean(callNumber),
    summary: clean(summary),
    series,
  };
}

function parseContributor(field: MarcField): MarcContributor | undefined {
  const name = clean(subfields(field, 'a')[0]);
  if (!name) return undefined;
  return { name, role: clean(subfields(field, 'e')[0]) };
}

function parseSeries(field: MarcField): MarcSeries | undefined {
  const name = clean(subfields(field, 'a')[0] ?? subfields(field, 't')[0]);
  if (!name) return undefined;
  return { name, volume: clean(subfields(field, 'v')[0]) };
}

function firstSubfield(
  fields: readonly MarcField[],
  tag: string,
  code: string,
): string | undefined {
  return subfields(
    fields.find((field) => field['@_tag'] === tag),
    code,
  )[0];
}

function joinSubfields(field: MarcField, codes: readonly string[]): string {
  return array(field.subfield)
    .filter((item) => codes.includes(item['@_code'] ?? ''))
    .map((item) => clean(item['#text']))
    .filter(Boolean)
    .join(' -- ');
}

function subfields(field: MarcField | undefined, code: string): readonly string[] {
  return array(field?.subfield)
    .filter((item) => item['@_code'] === code)
    .map((item) => String(item['#text'] ?? ''));
}

function clean(value: string | number | undefined): string | undefined {
  const cleaned = String(value ?? '')
    ?.replaceAll(/\s+/gu, ' ')
    .replace(/[\s/,:;.]+$/u, '')
    .trim();
  return cleaned || undefined;
}

function array<T>(value: T | readonly T[] | undefined): readonly T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value as T];
}
