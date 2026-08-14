import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const DEFAULT_CONFIG_PATH = 'data/bookshelf.json';

export interface BookshelfConfig {
  readonly version: 1;
  readonly database: string;
  readonly session: string;
  readonly household: { readonly id: string; readonly name: string };
  readonly reader: { readonly id: string; readonly name: string };
  readonly card: { readonly id: string; readonly label: string };
  readonly sourceAccount: { readonly id: string; readonly label: string };
  readonly maxReadMinutes?: number;
}

export interface ResolvedBookshelfConfig extends BookshelfConfig {
  readonly projectDirectory: string;
  readonly configFilename: string;
  readonly databaseFilename: string;
  readonly sessionFilename: string;
}

export function resolveProjectDirectory(): string {
  return resolve(process.env.INIT_CWD ?? process.cwd());
}

export function loadBookshelfConfig(
  projectDirectory: string,
  configPath = DEFAULT_CONFIG_PATH,
): ResolvedBookshelfConfig {
  const configFilename = resolve(projectDirectory, configPath);
  if (!existsSync(configFilename)) {
    throw new Error(`Bookshelf is not configured. Run "pnpm bookshelf setup" first.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(configFilename, 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Could not read bookshelf configuration at ${configFilename}`, {
      cause: error,
    });
  }
  const config = validateBookshelfConfig(parsed);
  return {
    ...config,
    projectDirectory,
    configFilename,
    databaseFilename: resolve(projectDirectory, config.database),
    sessionFilename: resolve(projectDirectory, config.session),
  };
}

export function saveBookshelfConfig(
  projectDirectory: string,
  config: BookshelfConfig,
  configPath = DEFAULT_CONFIG_PATH,
): ResolvedBookshelfConfig {
  validateBookshelfConfig(config);
  const configFilename = resolve(projectDirectory, configPath);
  mkdirSync(dirname(configFilename), { recursive: true });
  const temporaryFilename = `${configFilename}.tmp`;
  writeFileSync(temporaryFilename, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryFilename, configFilename);
  return {
    ...config,
    projectDirectory,
    configFilename,
    databaseFilename: resolve(projectDirectory, config.database),
    sessionFilename: resolve(projectDirectory, config.session),
  };
}

export function defaultBookshelfConfig(readerName: string, cardLabel?: string): BookshelfConfig {
  const slug = slugify(readerName) || 'child';
  return {
    version: 1,
    database: 'data/read-it-again.db',
    session: `secrets/${slug}-card.json`,
    household: { id: 'household-default', name: 'My Household' },
    reader: { id: `reader-${slug}`, name: readerName },
    card: { id: `card-${slug}-kcls`, label: cardLabel ?? `${readerName} KCLS card` },
    sourceAccount: {
      id: `source-${slug}-bibliocommons`,
      label: `${readerName} BiblioCommons history`,
    },
  };
}

function validateBookshelfConfig(value: unknown): BookshelfConfig {
  if (!isObject(value) || value.version !== 1) throw new Error('Unsupported bookshelf config');
  for (const key of ['database', 'session'] as const) requireText(value[key], key);
  for (const section of ['household', 'reader', 'card', 'sourceAccount'] as const) {
    const item = value[section];
    if (!isObject(item)) throw new Error(`Bookshelf config requires ${section}`);
    requireText(item.id, `${section}.id`);
    requireText(item[section === 'reader' || section === 'household' ? 'name' : 'label'], section);
  }
  if (
    value.maxReadMinutes !== undefined &&
    (!Number.isInteger(value.maxReadMinutes) || (value.maxReadMinutes as number) <= 0)
  ) {
    throw new Error('maxReadMinutes must be a positive integer');
  }
  return value as unknown as BookshelfConfig;
}

function requireText(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/gu, '')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '-')
    .replaceAll(/^-|-$/gu, '');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
