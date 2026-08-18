import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * `_headers` is the deploy contract and the one source of truth for security
 * headers. Production preview reads the same file so browser tests exercise the
 * policy that static hosting is expected to apply, rather than a hand-copied
 * approximation. The development server omits CSP because Vite injects styles;
 * its isolation headers still match production so SQLite-WASM behaves the same.
 */
const productionHeaders = readStaticHeaders(
  readFileSync(resolve(import.meta.dirname, 'public/_headers'), 'utf8'),
);
const developmentHeaders = Object.fromEntries(
  Object.entries(productionHeaders).filter(([name]) => name !== 'Content-Security-Policy'),
);

export default defineConfig({
  server: {
    headers: developmentHeaders,
  },
  preview: {
    headers: productionHeaders,
  },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
});

function readStaticHeaders(contents: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of contents.split(/\r?\n/u).slice(1)) {
    if (line.trim().length === 0) break;
    const match = /^\s{2}([^:]+):\s*(.+)$/u.exec(line);
    if (match) headers[match[1] as string] = match[2] as string;
  }
  return headers;
}
