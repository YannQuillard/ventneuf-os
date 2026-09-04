import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { migrate } from "@ventneuf/database";

interface DatabaseCredentials {
  username?: string;
  password?: string;
}

export function buildDatabaseUrl(
  host: string,
  databaseName: string,
  credentials: Required<DatabaseCredentials>,
) {
  const databaseUrl = new URL("postgresql://migrator@localhost");
  databaseUrl.username = credentials.username;
  databaseUrl.password = credentials.password;
  databaseUrl.hostname = host;
  databaseUrl.port = "5432";
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("sslmode", "require");
  return databaseUrl.toString();
}

export async function runMigrations(env = process.env) {
  const region = env.AWS_REGION ?? "eu-west-1";
  const secretId = env.DATABASE_SECRET_ID;
  const host = env.DATABASE_HOST;
  const databaseName = env.DATABASE_NAME;

  if (!secretId || !host || !databaseName) {
    throw new Error("Database migration configuration is required.");
  }

  const secrets = new SecretsManagerClient({ region });
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  const credentials = JSON.parse(secret.SecretString ?? "{}") as DatabaseCredentials;
  if (!credentials.username || !credentials.password) {
    throw new Error("Database migration credentials are incomplete.");
  }

  await migrate(buildDatabaseUrl(host, databaseName, {
    username: credentials.username,
    password: credentials.password,
  }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
}
