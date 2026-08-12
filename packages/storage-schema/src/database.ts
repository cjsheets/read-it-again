export type SqlValue = string | number | bigint | Uint8Array | null;

export type SqlParameters = readonly SqlValue[];

export type SqlRow = object;

/**
 * Smallest common database surface needed by repositories and migrations.
 * Runtime adapters own driver-specific behavior and normalize rows to objects.
 */
export interface Database {
  exec(sql: string): Promise<void>;
  run(sql: string, parameters?: SqlParameters): Promise<void>;
  query<T extends SqlRow>(sql: string, parameters?: SqlParameters): Promise<readonly T[]>;
  close(): Promise<void>;
}
