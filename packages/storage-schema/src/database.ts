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

/** How deep the current call stack is inside `inTransaction`, per database. */
const transactionDepth = new WeakMap<Database, number>();

/**
 * Nesting-aware: the outermost call opens a real transaction and inner calls use
 * savepoints. Without this, a bulk operation could not wrap per-row helpers that
 * open their own transaction, because a nested `BEGIN IMMEDIATE` fails — which
 * meant every imported row committed separately and paid its own durability cost.
 */
export async function inTransaction<T>(
  database: Database,
  operation: () => Promise<T>,
): Promise<T> {
  const depth = transactionDepth.get(database) ?? 0;
  const savepoint = depth > 0 ? `nested_${String(depth)}` : null;
  transactionDepth.set(database, depth + 1);
  await database.exec(savepoint ? `SAVEPOINT ${savepoint}` : 'BEGIN IMMEDIATE');
  try {
    const result = await operation();
    await database.exec(savepoint ? `RELEASE ${savepoint}` : 'COMMIT');
    return result;
  } catch (error) {
    await database.exec(savepoint ? `ROLLBACK TO ${savepoint}` : 'ROLLBACK');
    throw error;
  } finally {
    transactionDepth.set(database, depth);
  }
}
