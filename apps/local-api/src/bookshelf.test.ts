import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseArguments } from './bookshelf-arguments.js';
import {
  defaultBookshelfConfig,
  loadBookshelfConfig,
  saveBookshelfConfig,
} from './bookshelf-config.js';
import { backupBookshelf, getBookshelfStatus, initializeBookshelf } from './bookshelf-workflow.js';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true });
});

describe('bookshelf CLI', () => {
  it('parses commands, values, inline values, and flags', () => {
    expect(
      parseArguments([
        '--',
        'setup',
        '--reader-name',
        'Ada',
        '--max-read-minutes=12',
        '--skip-login',
      ]),
    ).toEqual({
      command: 'setup',
      options: { 'reader-name': 'Ada', 'max-read-minutes': '12', 'skip-login': 'true' },
    });
  });

  it('saves and loads a private, portable reader configuration', () => {
    const project = temporaryDirectory();
    const saved = saveBookshelfConfig(project, defaultBookshelfConfig('Éloïse'));
    expect(saved.reader.id).toBe('reader-eloise');
    expect(loadBookshelfConfig(project)).toMatchObject({
      reader: { id: 'reader-eloise', name: 'Éloïse' },
      databaseFilename: join(project, 'data/read-it-again.db'),
      sessionFilename: join(project, 'secrets/eloise-card.json'),
    });
    expect(JSON.parse(readFileSync(saved.configFilename, 'utf8'))).toMatchObject({ version: 1 });
  });

  it('initializes status and writes a PWA-compatible encrypted backup', async () => {
    const project = temporaryDirectory();
    const config = saveBookshelfConfig(project, defaultBookshelfConfig('Ada'));
    await initializeBookshelf(config);
    await expect(getBookshelfStatus(config)).resolves.toEqual({
      readerName: 'Ada',
      importedRecords: 0,
      pendingResolutions: 0,
      attributionReviews: 0,
      shelfItems: 0,
      recommendationItems: 0,
    });
    const archive = join(project, 'backups/bookshelf.json');
    await backupBookshelf(config, 'a sufficiently long passphrase', archive);
    expect(JSON.parse(readFileSync(archive, 'utf8'))).toMatchObject({
      format: 'read-it-again-encrypted-v1',
    });
  });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'read-it-again-cli-'));
  directories.push(directory);
  return directory;
}
