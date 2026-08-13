import { describe, expect, it } from 'vitest';
import {
  canonicalAuthor,
  canonicalIsbn,
  canonicalTitle,
  normalizeFormat,
} from './normalization.js';

describe('bibliographic normalization', () => {
  it.each([
    ['The Gruffalo', 'gruffalo'],
    ['  Goodnight, Gorilla! ', 'goodnight gorilla'],
    ['L’école des loisirs', 'lecole des loisirs'],
    ['Cats & Dogs', 'cats and dogs'],
  ])('normalizes title %s', (input, expected) => expect(canonicalTitle(input)).toBe(expected));

  it.each([
    ['Willems, Mo', 'willems mo'],
    ['Mo Willems', 'willems mo'],
    ['García Márquez, Gabriel', 'garcia marquez gabriel'],
  ])('normalizes author %s', (input, expected) => expect(canonicalAuthor(input)).toBe(expected));

  expect(canonicalIsbn('978-0-00-000010-1')).toBe('9780000000101');
  expect(canonicalIsbn('abc')).toBeUndefined();
  expect(normalizeFormat('Audio Book')).toBe('audiobook');
});
