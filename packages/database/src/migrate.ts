import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const statementSeparator = "--> statement-breakpoint";
const migrationsDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export function splitMigration(source: string) {
  return source
    .split(statementSeparator)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function migrate(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    await client`select pg_advisory_lock(hashtext('ventneuf_os_migrations'))`;
    await client`
      create table if not exists ventneuf_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamp with time zone default now() not null
      )
    `;

    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const name of files) {
      const source = await readFile(resolve(migrationsDirectory, name), "utf8");
      const checksum = createHash("sha256").update(source).digest("hex");
      const [existing] = await client<{ checksum: string }[]>`
        select checksum from ventneuf_migrations where name = ${name}
      `;

      if (existing) {
        if (existing.checksum !== checksum) {
          throw new Error(`Applied migration ${name} has been modified.`);
        }
        continue;
      }

      await client.begin(async (transaction) => {
        for (const statement of splitMigration(source)) {
          await transaction.unsafe(statement);
        }
        await transaction`
          insert into ventneuf_migrations (name, checksum) values (${name}, ${checksum})
        `;
      });
    }
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  await migrate(databaseUrl);
}
