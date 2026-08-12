import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { BrowserSqliteDatabase } from './database.js';

export async function openOpfsDatabase(filename: string): Promise<BrowserSqliteDatabase> {
  const sqlite3 = await sqlite3InitModule({
    print: () => undefined,
    printErr: (message: unknown) => console.error(message),
  });
  if (!('opfs' in sqlite3)) {
    throw new Error('SQLite OPFS support is unavailable; transient storage is not acceptable');
  }
  const database = new BrowserSqliteDatabase(new sqlite3.oo1.OpfsDb(filename));
  await database.exec('PRAGMA foreign_keys = ON');
  return database;
}
