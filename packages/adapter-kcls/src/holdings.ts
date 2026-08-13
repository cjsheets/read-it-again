import { XMLParser } from 'fast-xml-parser';

export interface ParsedHoldings {
  readonly systemAvailable: number;
  readonly systemTotal: number;
  readonly branches: readonly {
    readonly shortName: string;
    readonly name: string;
    readonly available: number | null;
    readonly callNumbers: readonly string[];
  }[];
}

export function parseHoldings(xml: string): ParsedHoldings {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
  });
  const document = parser.parse(xml) as unknown;
  const objects = collectObjects(document);
  const aggregate = objects.find(
    (value) =>
      (number(value.available) !== undefined || number(value['@_available']) !== undefined) &&
      (number(value.count) !== undefined ||
        number(value.total) !== undefined ||
        number(value['@_count']) !== undefined),
  );
  const volumes = objects.filter(
    (value) =>
      value.branch !== undefined ||
      value.branch_name !== undefined ||
      value.shortname !== undefined,
  );
  const branches = new Map<
    string,
    { shortName: string; name: string; available: number | null; callNumbers: Set<string> }
  >();
  for (const volume of volumes) {
    const branchObject = object(volume.branch);
    const shortName =
      text(volume.shortname) ||
      text(volume.branch_shortname) ||
      text(branchObject?.shortname) ||
      text(branchObject?.['@_shortname']);
    const name =
      text(volume.branch_name) ||
      text(branchObject?.name) ||
      text(branchObject?.['#text']) ||
      shortName;
    if (!shortName && !name) continue;
    const key = shortName || name;
    const current = branches.get(key) ?? {
      shortName: shortName || name,
      name: name || shortName,
      available: null,
      callNumbers: new Set<string>(),
    };
    const available = number(volume.available) ?? number(volume['@_available']);
    if (available !== undefined) current.available = (current.available ?? 0) + available;
    const callNumber = text(volume.call_number) || text(volume.callnumber) || text(volume.label);
    if (callNumber) current.callNumbers.add(callNumber);
    branches.set(key, current);
  }
  return {
    systemAvailable:
      number(aggregate?.available) ??
      number(aggregate?.['@_available']) ??
      sum([...branches.values()].map(({ available }) => available ?? 0)),
    systemTotal:
      number(aggregate?.count) ??
      number(aggregate?.['@_count']) ??
      number(aggregate?.total) ??
      volumes.length,
    branches: [...branches.values()]
      .map((branch) => ({ ...branch, callNumbers: [...branch.callNumbers].sort() }))
      .sort((a, b) => a.shortName.localeCompare(b.shortName)),
  };
}

function collectObjects(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(collectObjects);
  const current = object(value);
  return current ? [current, ...Object.values(current).flatMap(collectObjects)] : [];
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value).trim();
  const valueObject = object(value);
  return valueObject ? text(valueObject['#text']) : '';
}

function number(value: unknown): number | undefined {
  const valueText = text(value);
  if (!valueText) return undefined;
  const parsed = Number(valueText);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
