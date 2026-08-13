const LEADING_ARTICLES = new Set(['a', 'an', 'the']);

export function canonicalTitle(value: string): string {
  const tokens = normalizeWords(value);
  return (LEADING_ARTICLES.has(tokens[0] ?? '') ? tokens.slice(1) : tokens).join(' ');
}

export function tokenizeTitle(value: string): readonly string[] {
  return canonicalTitle(value).split(' ').filter(Boolean);
}

export function canonicalAuthor(value: string): string {
  const comma = value.split(',').map((part) => normalizeWords(part).join(' '));
  if (comma.length === 2 && comma[0]) return `${comma[0]} ${comma[1] ?? ''}`.trim();
  const words = normalizeWords(value);
  return words.length < 2 ? words.join(' ') : `${words.at(-1)} ${words.slice(0, -1).join(' ')}`;
}

export function canonicalIsbn(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.toUpperCase().replaceAll(/[^0-9X]/g, '');
  return normalized.length === 10 || normalized.length === 13 ? normalized : undefined;
}

export function normalizeFormat(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeWords(value).join('-');
  const aliases: Readonly<Record<string, string>> = {
    'audio-book': 'audiobook',
    audio: 'audiobook',
    eBook: 'ebook',
    'electronic-book': 'ebook',
    'easy-reader': 'easy-reader',
  };
  return aliases[normalized] ?? normalized;
}

function normalizeWords(value: string): string[] {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en-US')
    .replaceAll(/&/g, ' and ')
    .replaceAll(/[’']/g, '')
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
}
