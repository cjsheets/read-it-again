import BetterSqlite3 from 'better-sqlite3';
import type { Database, SqlParameters, SqlRow } from '@read-it-again/storage-schema';

export class NodeSqliteDatabase implements Database {
  readonly #database: BetterSqlite3.Database;

  constructor(filename = ':memory:') {
    this.#database = new BetterSqlite3(filename);
    this.#database.pragma('foreign_keys = ON');
  }

  async exec(sql: string): Promise<void> {
    this.#database.exec(sql);
  }

  async run(sql: string, parameters: SqlParameters = []): Promise<void> {
    this.#database.prepare(sql).run(...parameters);
  }

  async query<T extends SqlRow>(
    sql: string,
    parameters: SqlParameters = [],
  ): Promise<readonly T[]> {
    return this.#database.prepare(sql).all(...parameters) as T[];
  }

  async close(): Promise<void> {
    this.#database.close();
  }
}
