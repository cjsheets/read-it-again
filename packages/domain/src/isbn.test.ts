import { describe, expect, it } from 'vitest';
import { booklandIsbn, isbnVariants, isValidIsbn } from './normalization.js';

describe('isValidIsbn', () => {
  it('accepts real ISBN-13 and ISBN-10 numbers', () => {
    // Each check digit was computed by hand rather than recalled: weights of 1 and
    // 3 summing to a multiple of ten for ISBN-13, weights 10..1 summing to a
    // multiple of eleven for ISBN-10.
    expect(isValidIsbn('9780333710937')).toBe(true); // The Gruffalo
    expect(isValidIsbn('9780306406157')).toBe(true); // ISBN-13 of 0-306-40615-2
    expect(isValidIsbn('0306406152')).toBe(true);
    expect(isValidIsbn('043942089X')).toBe(true); // check digit ten, written X
    expect(isValidIsbn('978-0-333-71093-7')).toBe(true); // hyphens are cosmetic
  });

  it('rejects a single mistyped digit, which is the point', () => {
    expect(isValidIsbn('9780333710938')).toBe(false);
    expect(isValidIsbn('0439420891')).toBe(false);
  });

  it('rejects anything that is not an ISBN at all', () => {
    expect(isValidIsbn(undefined)).toBe(false);
    expect(isValidIsbn('')).toBe(false);
    expect(isValidIsbn('12345')).toBe(false);
    expect(isValidIsbn('not a number')).toBe(false);
  });
});

describe('isbnVariants', () => {
  it('pairs an ISBN-13 with its ISBN-10 spelling and the reverse', () => {
    // 0-306-40615-2 and 978-0-306-40615-7 are the same edition.
    expect(isbnVariants('9780306406157')).toEqual(['9780306406157', '0306406152']);
    expect(isbnVariants('0306406152')).toEqual(['0306406152', '9780306406157']);
    expect(isbnVariants('978-0-333-71093-7')).toEqual(['9780333710937', '0333710932']);
  });

  it('leaves a 979 ISBN alone, because it has no ISBN-10 form', () => {
    // 979-8-88760-000-0: the first twelve digits weight to 120, so the check
    // digit is zero. The 979 prefix has no ten-digit equivalent.
    const isbn = '9798887600000';
    expect(isValidIsbn(isbn)).toBe(true);
    expect(isbnVariants(isbn)).toEqual([isbn]);
  });

  it('does not invent a partner for a number that fails its check digit', () => {
    expect(isbnVariants('9780306406158')).toEqual(['9780306406158']);
    expect(isbnVariants('nonsense')).toEqual([]);
  });
});

describe('booklandIsbn', () => {
  it('accepts the EAN-13 printed on a book', () => {
    expect(booklandIsbn('9780306406157')).toBe('9780306406157');
    expect(booklandIsbn('9798887600000')).toBe('9798887600000');
  });

  it('rejects a barcode that is not a book', () => {
    // A real EAN-13 with a sound check digit, in a grocery prefix rather than
    // Bookland. Scanning the wrong thing on the table must not add a book.
    expect(isValidIsbn('4006381333931')).toBe(true);
    expect(booklandIsbn('4006381333931')).toBeUndefined();
  });

  it('rejects a Bookland number whose check digit does not hold', () => {
    expect(booklandIsbn('9780306406158')).toBeUndefined();
  });

  it('rejects an ISBN-10, which is never what a barcode reads', () => {
    expect(booklandIsbn('0306406152')).toBeUndefined();
  });
});
