import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArguments } from './bookshelf-arguments.js';
import {
  DEFAULT_CONFIG_PATH,
  defaultBookshelfConfig,
  loadBookshelfConfig,
  resolveProjectDirectory,
  saveBookshelfConfig,
} from './bookshelf-config.js';
import {
  backupBookshelf,
  getBookshelfStatus,
  initializeBookshelf,
  loginBookshelf,
  recommendBookshelf,
  syncBookshelf,
} from './bookshelf-workflow.js';

const { command, options } = parseArguments(process.argv.slice(2));
const projectDirectory = resolveProjectDirectory();
const configPath = options.config ?? DEFAULT_CONFIG_PATH;

try {
  switch (command) {
    case 'setup': {
      if (existsSync(resolve(projectDirectory, configPath)) && options.force !== 'true') {
        throw new Error(`Configuration already exists at ${configPath}; use --force to replace it`);
      }
      const readerName =
        options['reader-name'] ??
        (await promptText('Reader name', 'Child', options['non-interactive']));
      const cardLabel =
        options['card-label'] ??
        (await promptText(
          'Library card label',
          `${readerName} KCLS card`,
          options['non-interactive'],
        ));
      const draft = defaultBookshelfConfig(readerName, cardLabel);
      const maxReadMinutes = parsePositiveInteger(options['max-read-minutes']);
      const config = saveBookshelfConfig(
        projectDirectory,
        maxReadMinutes ? { ...draft, maxReadMinutes } : draft,
        configPath,
      );
      await initializeBookshelf(config);
      console.log(`✓ Saved configuration to ${config.configFilename}`);
      console.log(`✓ Initialized database at ${config.databaseFilename}`);
      if (options['skip-login'] !== 'true') {
        await loginBookshelf(config);
        console.log(`✓ Saved private library session to ${config.sessionFilename}`);
      } else {
        console.log('Next: pnpm bookshelf login');
      }
      break;
    }
    case 'login': {
      const config = loadBookshelfConfig(projectDirectory, configPath);
      await loginBookshelf(config);
      console.log(`✓ Saved private library session to ${config.sessionFilename}`);
      break;
    }
    case 'sync': {
      const config = loadBookshelfConfig(projectDirectory, configPath);
      if (!existsSync(config.sessionFilename)) {
        throw new Error('No library session exists. Run "pnpm bookshelf login" first.');
      }
      const status = await syncBookshelf(config);
      printStatus(status);
      if (status.pendingResolutions > 0 || status.attributionReviews > 0) {
        console.log('\nReview is needed before recommendations use the complete history.');
      }
      break;
    }
    case 'status':
      printStatus(await getBookshelfStatus(loadBookshelfConfig(projectDirectory, configPath)));
      break;
    case 'recommend': {
      const result = await recommendBookshelf(loadBookshelfConfig(projectDirectory, configPath));
      console.log(
        `✓ Generated ${result.discovery} recommendations and ${result.readAgain} read-again choices`,
      );
      break;
    }
    case 'backup': {
      const config = loadBookshelfConfig(projectDirectory, configPath);
      const passphrase =
        process.env.BOOKSHELF_BACKUP_PASSPHRASE ?? (await promptSecret('Archive passphrase: '));
      const output = resolve(
        projectDirectory,
        options.output ?? `backups/read-it-again-${backupTimestamp(new Date())}.json`,
      );
      await backupBookshelf(config, passphrase, output);
      console.log(`✓ Wrote encrypted PWA-compatible archive to ${output}`);
      break;
    }
    case 'help':
      printHelp();
      break;
    default:
      printHelp();
      process.exitCode = 1;
  }
} catch (error) {
  console.error(
    `\nBookshelf ${command} failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}

function printStatus(status: Awaited<ReturnType<typeof getBookshelfStatus>>): void {
  console.log(`\n${status.readerName}'s bookshelf`);
  console.log(`  Imported records:       ${status.importedRecords}`);
  console.log(`  Shelf items:            ${status.shelfItems}`);
  console.log(`  Pending resolutions:    ${status.pendingResolutions}`);
  console.log(`  Attribution reviews:    ${status.attributionReviews}`);
  console.log(`  Recommendation items:   ${status.recommendationItems}`);
  console.log(`  Last import:            ${status.lastImportAt ?? 'never'}`);
  console.log(`  Last recommendations:   ${status.lastRecommendationAt ?? 'never'}`);
}

async function promptText(
  label: string,
  fallback: string,
  nonInteractive?: string,
): Promise<string> {
  if (nonInteractive === 'true') return fallback;
  if (!process.stdin.isTTY) throw new Error(`${label} is required in a non-interactive terminal`);
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await prompt.question(`${label} [${fallback}]: `)).trim();
    return answer || fallback;
  } finally {
    prompt.close();
  }
}

async function promptSecret(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) {
    throw new Error('Set BOOKSHELF_BACKUP_PASSPHRASE when running backup non-interactively');
  }
  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  let value = '';
  try {
    let complete = false;
    for await (const input of process.stdin) {
      for (const character of String(input)) {
        if (character === '\r' || character === '\n') {
          complete = true;
          break;
        }
        if (character === '\u0003') throw new Error('Backup cancelled');
        if (character === '\u007f') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
      if (complete) break;
    }
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write('\n');
  }
  return value;
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0)
    throw new Error('--max-read-minutes must be positive');
  return parsed;
}

function backupTimestamp(now: Date): string {
  return now.toISOString().replaceAll(':', '-').replace('.000', '');
}

function printHelp(): void {
  console.log(`Read It Again bookshelf

Usage: pnpm bookshelf <command> [options]

Commands:
  setup       Configure a reader, initialize storage, and sign in
  login       Open a browser to create or refresh the private library session
  sync        Import, resolve, enrich, rebuild, and recommend
  status      Show data freshness and outstanding review counts
  recommend   Rebuild recommendations without importing
  backup      Create an encrypted archive that the PWA can import

Options:
  --config <path>             Configuration file (default: data/bookshelf.json)
  --reader-name <name>        Reader name for setup
  --card-label <label>        Library card label for setup
  --max-read-minutes <count>  Optional bedtime constraint for setup
  --skip-login                Configure without opening a browser
  --non-interactive           Accept setup defaults when values are omitted
  --force                     Replace an existing setup
  --output <path>             Backup destination
`);
}
