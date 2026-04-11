import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getEnv } from "@/lib/env";

declare global {
  // eslint-disable-next-line no-var
  var __bamPool__: Pool | undefined;
}

function createPool() {
  return new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: 10,
  });
}

export const pool = global.__bamPool__ ?? createPool();

if (!global.__bamPool__) {
  global.__bamPool__ = pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  return pool.query<T>(text, params);
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function isDatabaseReachable() {
  try {
    await query("select 1 as ok");
    return true;
  } catch {
    return false;
  }
}

export async function closePool() {
  await pool.end();
}
