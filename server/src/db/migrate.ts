import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";

export async function migrate() {
  const pool = getPool();
  const dir = path.resolve(process.cwd(), "server/migrations");
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  for (const file of files) {
    const done = await pool.query("SELECT 1 FROM schema_migrations WHERE id = $1", [file]);
    if (done.rowCount) continue;
    const sql = readFileSync(path.join(dir, file), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
      await pool.query("COMMIT");
    } catch (error) {
      await pool.query("ROLLBACK");
      throw error;
    }
  }
}

const isMain = process.argv[1]?.includes("migrate.ts") || process.argv[1]?.includes("migrate.js");
if (isMain) {
  migrate()
    .then(() => {
      console.log("Миграции применены");
      return getPool().end();
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
