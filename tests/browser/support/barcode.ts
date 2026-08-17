import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Renders an EAN-13 barcode into a Y4M video file, so Chromium's fake camera can
 * play it back and the scanner can be tested by actually decoding something.
 *
 * The alternative — stubbing the decoder — would test the plumbing and leave the
 * one part that can really fail unexercised. A synthetic barcode is a clean,
 * head-on, perfectly lit read, so it proves the decoder is wired up and reachable;
 * it says nothing about hit rates on a creased paperback in a dim hallway, which
 * is what the audit's field trial (§8.5) exists to answer.
 */

/** The ISBN the fake camera shows. 978-0-306-40615-7, whose check digit was
 *  worked out by hand in `packages/domain/src/isbn.test.ts`. */
export const FIXTURE_ISBN = '9780306406157';

/** Where the generated video lands. Gitignored: it is a build product of the test
 *  suite, and a megabyte of pixels does not belong in source control. */
export const FIXTURE_VIDEO = '.playwright-fixtures/barcode.y4m';

/** Left-hand odd parity. The right-hand set is its bitwise complement. */
const L = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
];

/** Left-hand even parity: the right-hand pattern read backwards. */
const G = [
  '0100111',
  '0110011',
  '0011011',
  '0100001',
  '0011101',
  '0111001',
  '0000101',
  '0010001',
  '0001001',
  '0010111',
];

/**
 * EAN-13 stores only twelve digits as bars. The thirteenth — the first one — is
 * carried by which of the six left digits use even parity, which is why the
 * pattern table is indexed by it.
 */
const PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
];

/** True where the barcode is dark. 95 modules: guards, two digit groups, guards. */
export function ean13Modules(isbn: string): readonly boolean[] {
  if (!/^\d{13}$/u.test(isbn)) throw new Error(`Not thirteen digits: ${isbn}`);
  const digits = [...isbn].map(Number);
  const parity = PARITY[digits[0] as number] as string;
  let bits = '101';
  for (let index = 0; index < 6; index += 1) {
    const digit = digits[index + 1] as number;
    bits += parity[index] === 'L' ? (L[digit] as string) : (G[digit] as string);
  }
  bits += '01010';
  for (let index = 7; index < 13; index += 1) {
    // The right-hand set is the complement of the left-hand odd set.
    bits += [...(L[digits[index] as number] as string)]
      .map((bit) => (bit === '0' ? '1' : '0'))
      .join('');
  }
  bits += '101';
  return [...bits].map((bit) => bit === '1');
}

const WIDTH = 640;
const HEIGHT = 480;
const MODULE = 4;
const BAR_HEIGHT = 220;

/**
 * A single-frame Y4M. Chromium loops the file, so one frame plays as a still
 * camera pointed at a barcode — which is what a person scanning a book does.
 */
export function writeBarcodeVideo(isbn: string, file: string): void {
  const modules = ean13Modules(isbn);
  const barWidth = modules.length * MODULE;
  const left = Math.floor((WIDTH - barWidth) / 2);
  const top = Math.floor((HEIGHT - BAR_HEIGHT) / 2);

  // White page, dark bars. Full-range luma either way, so no thresholding
  // subtlety stands between the fixture and the decoder.
  const luma = Buffer.alloc(WIDTH * HEIGHT, 235);
  for (let y = top; y < top + BAR_HEIGHT; y += 1) {
    for (let index = 0; index < modules.length; index += 1) {
      if (!modules[index]) continue;
      const start = left + index * MODULE;
      luma.fill(16, y * WIDTH + start, y * WIDTH + start + MODULE);
    }
  }
  // Neutral chroma at half resolution, which is what C420 means.
  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128);

  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(
    file,
    Buffer.concat([
      Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F15:1 Ip A1:1 C420\n`),
      Buffer.from('FRAME\n'),
      luma,
      chroma,
      chroma,
    ]),
  );
}
