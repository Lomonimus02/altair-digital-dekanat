import pg from "pg";

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
import { drizzle } from "drizzle-orm/node-postgres";
import { getConfig } from "../config";
import * as schema from "./schema";

let pool: pg.Pool | null = null;

export function getPool() {
  if (!pool) {
    const url = getConfig().databaseUrl;
    if (!url) throw new Error("DATABASE_URL не задан");
    pool = new pg.Pool({ connectionString: url, max: 4, idleTimeoutMillis: 10_000 });
    pool.on("error", (error) => {
      console.error("pg pool", error.message);
    });
  }
  return pool;
}

export function getDb() {
  return drizzle(getPool(), { schema });
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
