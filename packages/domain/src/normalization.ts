const LEADING_ARTICLES = new Set(['a', 'an', 'the']);

export function canonicalTitle(value: string): string {
  const tokens = normalizeWords(value);
  return (LEADING_ARTICLES.has(tokens[0] ?? '') ? tokens.slice(1) : tokens).join(' ');
}

/**
 * The form a title or author is stored in for searching. Unlike `canonicalTitle`
 * this keeps leading articles, because a person typing "the gru" expects "The
 * Gruffalo" to match; dropping the article is right for identity matching and
 * wrong for search. Diacritics are folded and punctuation becomes whitespace, so
 * "L'Ecole" and "L’École" both find each other.
 */
export function searchText(value: string): string {
  return value
    .normalize('NFD')
    .replaceAll(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('en-US')
    .replaceAll(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .trim();
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

/**
 * Whether an ISBN's check digit is arithmetically consistent. Pure arithmetic, no
 * network, no catalog — it catches a mistyped digit the moment it is entered and
 * rejects a misread barcode before it becomes a book.
 *
 * A valid check digit does not mean the ISBN was ever assigned to anything; it
 * only means the number is not obviously wrong. ADR 0004's separation of works
 * from editions is what handles the rest: an ISBN identifies an edition, and not
 * every book has a usable one.
 */
export function isValidIsbn(value: string | undefined): boolean {
  const isbn = canonicalIsbn(value);
  if (!isbn) return false;
  if (isbn.length === 10) {
    // Positions weight 10..1; the final digit may be X, meaning ten.
    const sum = [...isbn].reduce((total, character, index) => {
      const digit = character === 'X' ? 10 : Number(character);
      return total + digit * (10 - index);
    }, 0);
    return sum % 11 === 0;
  }
  // EAN-13: alternating weights of 1 and 3, total divisible by ten.
  const sum = [...isbn].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return sum % 10 === 0;
}

/**
 * Every spelling of the same ISBN, canonical form first.
 *
 * A scanned EAN-13 barcode always yields thirteen digits, but a book imported
 * from a CSV or a library timeline may have been recorded as ten. They identify
 * the same edition, so a lookup that only matched the spelling it was handed
 * would create a duplicate for a book already on the shelf.
 *
 * Only the 978 prefix converts: 979 ISBN-13s have no ISBN-10 equivalent, and
 * inventing one would produce a number belonging to a different book.
 */
export function isbnVariants(value: string | undefined): readonly string[] {
  const isbn = canonicalIsbn(value);
  if (!isbn || !isValidIsbn(isbn)) return isbn ? [isbn] : [];
  if (isbn.length === 10) {
    const body = `978${isbn.slice(0, 9)}`;
    return [isbn, body + checkDigit13(body)];
  }
  if (!isbn.startsWith('978')) return [isbn];
  const body = isbn.slice(3, 12);
  return [isbn, body + checkDigit10(body)];
}

function checkDigit13(body: string): string {
  const sum = [...body].reduce(
    (total, character, index) => total + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return String((10 - (sum % 10)) % 10);
}

function checkDigit10(body: string): string {
  const sum = [...body].reduce(
    (total, character, index) => total + Number(character) * (10 - index),
    0,
  );
  const remainder = (11 - (sum % 11)) % 11;
  return remainder === 10 ? 'X' : String(remainder);
}

/**
 * The ISBN in a scanned EAN-13, or undefined if the barcode is not a book.
 *
 * Every retail barcode is EAN-13, so a cereal box scans perfectly well and hands
 * back thirteen valid digits. Books live in the Bookland prefixes, 978 and 979 —
 * that test plus the check digit is what stops a misread, or the wrong object on
 * the table, from becoming a book on the shelf.
 */
export function booklandIsbn(value: string | undefined): string | undefined {
  const isbn = canonicalIsbn(value);
  if (!isbn || isbn.length !== 13) return undefined;
  if (!isbn.startsWith('978') && !isbn.startsWith('979')) return undefined;
  return isValidIsbn(isbn) ? isbn : undefined;
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
