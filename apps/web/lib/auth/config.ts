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

export function getAuthConfig(environment: AuthEnvironment = process.env): AuthConfig {
  const issuerBaseUrl = required(environment, "COGNITO_DOMAIN").replace(/\/$/, "");
  const parsedIssuer = new URL(issuerBaseUrl);

  if (environment.NODE_ENV === "production" && parsedIssuer.protocol !== "https:") {
    throw new Error("COGNITO_DOMAIN must use HTTPS in production.");
  }

  const sessionSecret = required(environment, "AUTH_SESSION_SECRET");

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
