import { createHousehold, listHouseholds } from './households.js';
import { migrate, migrations } from './migrations.js';
import type { Database } from './database.js';

export interface ConformanceResult {
  readonly migrationCount: number;
  readonly householdCount: number;
}

/** Runs the shared observable-behavior contract against any storage adapter. */
export async function runRepositoryConformance(
  database: Database,
  namespace: string,
): Promise<ConformanceResult> {
  await migrate(database);
  await migrate(database);

  const migrationRows = await database.query<{ count: number }>(
    'SELECT count(*) AS count FROM schema_migrations',
  );
  if (migrationRows[0]?.count !== migrations.length) {
    throw new Error(`Expected ${migrations.length} migrations, got ${migrationRows[0]?.count}`);
  }

  const first: Household = {
    id: `${namespace}-a`,
    name: 'Alder Household',
    createdAt: '2026-08-12T10:00:00.000Z',
  };
  const second: Household = {
    id: `${namespace}-b`,
    name: 'Birch Household',
    createdAt: '2026-08-12T11:00:00.000Z',
  };
  await createHousehold(database, first);
  await createHousehold(database, second);

  const households = await listHouseholds(database);
  const selected = households.filter(({ id }) => id.startsWith(`${namespace}-`));
  if (
    selected.length !== 2 ||
    selected[0]?.name !== first.name ||
    selected[1]?.name !== second.name
  ) {
    throw new Error(`Repository returned unexpected households: ${JSON.stringify(selected)}`);
  }

  return { migrationCount: migrations.length, householdCount: selected.length };
}

type Household = Parameters<typeof createHousehold>[1];
