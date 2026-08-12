import type { Database } from './database.js';

export interface Household {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}

interface HouseholdRow {
  readonly id: string;
  readonly name: string;
  readonly created_at: string;
}

export async function createHousehold(database: Database, household: Household): Promise<void> {
  await database.run('INSERT INTO households (id, name, created_at) VALUES (?, ?, ?)', [
    household.id,
    household.name,
    household.createdAt,
  ]);
}

export async function listHouseholds(database: Database): Promise<readonly Household[]> {
  const rows = await database.query<HouseholdRow>(
    'SELECT id, name, created_at FROM households ORDER BY created_at, id',
  );
  return rows.map((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));
}
