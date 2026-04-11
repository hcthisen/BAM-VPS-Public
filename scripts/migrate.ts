import "dotenv/config";

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { query, withTransaction } from "@/lib/db";

async function main() {
  await query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const migrationsDir = path.join(process.cwd(), "db", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const existing = await query<{ version: string }>("select version from schema_migrations where version = $1", [file]);
    if (existing.rowCount) {
      continue;
    }

    const sql = readFileSync(path.join(migrationsDir, file), "utf8");

    await withTransaction(async (client) => {
      await client.query(sql);
      await client.query("insert into schema_migrations (version) values ($1)", [file]);
    });

    console.log(`Applied migration ${file}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
