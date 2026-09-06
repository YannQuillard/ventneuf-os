import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export interface AuthConfig {
  clientId: string;
  issuerBaseUrl: string;
  logoutUri: string;
  redirectUri: string;
  sessionSecret: string;
  sessionMaxAgeSeconds: number;
}

const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type AuthEnvironment = Record<string, string | undefined>;
type SecretReader = (parameterName: string) => Promise<string | undefined>;

const ssm = new SSMClient({});
const parameterCache = new Map<string, Promise<string>>();

async function readParameter(parameterName: string): Promise<string> {
  const cached = parameterCache.get(parameterName);
  if (cached) return cached;

  const pending = ssm
    .send(new GetParameterCommand({ Name: parameterName, WithDecryption: true }))
    .then(({ Parameter }) => {
      const value = Parameter?.Value?.trim();
      if (!value) throw new Error("AUTH_SESSION_SECRET is required to use authentication.");
      return value;
    })
    .catch((error: unknown) => {
      parameterCache.delete(parameterName);
      throw error;
    });

  parameterCache.set(parameterName, pending);
  return pending;
}

function amplifySecret(environment: AuthEnvironment, name: string): string | undefined {
  const encoded = environment.secrets?.trim();

  if (!encoded) return undefined;

  try {
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const value = (parsed as Record<string, unknown>)[name];
    return typeof value === "string" ? value.trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

function required(environment: AuthEnvironment, name: string): string {
  const value = environment[name]?.trim() || amplifySecret(environment, name);

  if (!value) {
    throw new Error(`${name} is required to use authentication.`);
  }

  return value;
}

async function resolveSessionSecret(
  environment: AuthEnvironment,
  secretReader: SecretReader,
): Promise<string> {
  const inlineSecret = environment.AUTH_SESSION_SECRET?.trim() || amplifySecret(environment, "AUTH_SESSION_SECRET");
  if (inlineSecret) return inlineSecret;

  const parameterName = environment.AUTH_SESSION_SECRET_PARAMETER?.trim();
  const parameterSecret = parameterName ? await secretReader(parameterName) : undefined;
  if (!parameterSecret) throw new Error("AUTH_SESSION_SECRET is required to use authentication.");
  return parameterSecret;
}

export async function getAuthConfig(
  environment: AuthEnvironment = process.env,
  secretReader: SecretReader = readParameter,
): Promise<AuthConfig> {
  const issuerBaseUrl = required(environment, "COGNITO_DOMAIN").replace(/\/$/, "");
  const parsedIssuer = new URL(issuerBaseUrl);

  if (environment.NODE_ENV === "production" && parsedIssuer.protocol !== "https:") {
    throw new Error("COGNITO_DOMAIN must use HTTPS in production.");
  }

  const sessionSecret = await resolveSessionSecret(environment, secretReader);

  if (sessionSecret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters.");
  }

  return {
    clientId: required(environment, "COGNITO_CLIENT_ID"),
    issuerBaseUrl,
    logoutUri: required(environment, "AUTH_LOGOUT_URI"),
    redirectUri: required(environment, "AUTH_REDIRECT_URI"),
    sessionSecret,
    sessionMaxAgeSeconds: DEFAULT_SESSION_MAX_AGE_SECONDS,
  };
}
