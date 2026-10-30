import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import * as schema from "./schema";

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
types.setTypeParser(1082, (v) => v);

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;

const globalForDb = globalThis as unknown as { __ycrmPool?: Pool; __ycrmDb?: DB };

function connectionString() {
  const url = process.env.VITEST ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  return url;
}

export function getPool(): Pool {
  if (!globalForDb.__ycrmPool) {
    globalForDb.__ycrmPool = new Pool({ connectionString: connectionString(), max: 10 });
  }
  return globalForDb.__ycrmPool;
}

export const db: DB = new Proxy({} as DB, {
  get(_t, prop) {
    if (!globalForDb.__ycrmDb) globalForDb.__ycrmDb = drizzle(getPool(), { schema });
    return Reflect.get(globalForDb.__ycrmDb, prop);
  },
});

export { schema };
