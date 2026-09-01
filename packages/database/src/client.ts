import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
  const db = drizzle(client, { schema });

  return {
    withOrganization<T>(
      organizationId: string,
      operation: (transaction: DatabaseTransaction) => Promise<T>,
    ) {
      return db.transaction(async (transaction) => {
        await transaction.execute(
          sql`select set_config('app.organization_id', ${organizationId}, true)`,
        );
        return operation(transaction);
      });
    },
    close: () => client.end(),
  };
}

type DrizzleDatabase = ReturnType<typeof drizzle<typeof schema>>;
export type DatabaseTransaction = Parameters<Parameters<DrizzleDatabase["transaction"]>[0]>[0];
export type Database = ReturnType<typeof createDatabase>;
