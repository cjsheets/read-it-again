import type { Database, SqlParameters, SqlRow } from '@read-it-again/storage-schema';

interface Oo1Database {
  exec(options: {
    readonly sql: string;
    readonly bind?: SqlParameters;
    readonly rowMode?: 'object';
    readonly returnValue?: 'resultRows';
  }): unknown;
  close(): void;
}

export class BrowserSqliteDatabase implements Database {
  private readonly database: Oo1Database;

  constructor(database: unknown) {
    this.database = database as Oo1Database;
  }

  async exec(sql: string): Promise<void> {
    this.database.exec({ sql });
  }

  async run(sql: string, parameters: SqlParameters = []): Promise<void> {
    this.database.exec({ sql, bind: parameters });
  }

  async query<T extends SqlRow>(
    sql: string,
    parameters: SqlParameters = [],
  ): Promise<readonly T[]> {
    return this.database.exec({
      sql,
      bind: parameters,
      rowMode: 'object',
      returnValue: 'resultRows',
    }) as T[];
  }

  async close(): Promise<void> {
    this.database.close();
  }
}
