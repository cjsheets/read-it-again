import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceFiles = [
  resolve(root, 'apps/web/package.json'),
  ...(await files(resolve(root, 'apps/web/src'))),
];
const sourceForbidden = [
  '@read-it-again/adapter-bibliocommons',
  '@read-it-again/adapter-kcls',
  '@read-it-again/application-local',
];
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8');
  for (const token of sourceForbidden)
    if (content.includes(token)) fail(`${file} contains ${token}`);
}

const artifactFiles = await files(resolve(root, 'apps/web/dist'));
const artifactForbidden = [
  'kcls.bibliocommons.com',
  'recentlyreturned',
  'storageState',
  'CHILD_CARD_ID',
  'CHILD_PERSON_NAME',
  'w3.kcls.org',
  'opac/extras/opensearch',
];
for (const file of artifactFiles) {
  if (/\.(?:wasm|svg|png|jpg|jpeg|webp|ico)$/u.test(file)) continue;
  const content = await readFile(file, 'utf8');
  for (const token of artifactForbidden)
    if (content.includes(token)) fail(`${file} contains ${token}`);
}

const index = await readFile(resolve(root, 'apps/web/dist/index.html'), 'utf8');
if (/http-equiv=["']Content-Security-Policy["']/iu.test(index))
  fail('production index duplicates the header CSP in a meta policy');
if (!index.includes('manifest.webmanifest')) fail('production index has no web manifest');
const serviceWorker = await readFile(resolve(root, 'apps/web/dist/service-worker.js'), 'utf8');
if (!serviceWorker.includes('caches.open'))
  fail('service worker does not cache the application shell');
const headers = await readFile(resolve(root, 'apps/web/dist/_headers'), 'utf8');
for (const header of [
  'Content-Security-Policy',
  'Cross-Origin-Embedder-Policy: require-corp',
  'Cross-Origin-Opener-Policy: same-origin',
]) {
  if (!headers.includes(header)) fail(`static header contract is missing ${header}`);
}
console.log(
  `PWA boundary passed across ${sourceFiles.length} source and ${artifactFiles.length} artifact files.`,
);

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : [path];
      }),
    )
  ).flat();
}
function fail(message) {
  console.error(message);
  process.exit(1);
}
