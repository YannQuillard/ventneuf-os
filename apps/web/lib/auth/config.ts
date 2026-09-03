export interface AuthConfig {
  clientId: string;
  issuerBaseUrl: string;
  logoutUri: string;
  redirectUri: string;
  sessionSecret: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is required to use authentication.`);
  }

  return value;
}

export function getAuthConfig(): AuthConfig {
  const issuerBaseUrl = required("COGNITO_DOMAIN").replace(/\/$/, "");
  const parsedIssuer = new URL(issuerBaseUrl);

  if (process.env.NODE_ENV === "production" && parsedIssuer.protocol !== "https:") {
    throw new Error("COGNITO_DOMAIN must use HTTPS in production.");
  }

  const sessionSecret = required("AUTH_SESSION_SECRET");

  if (sessionSecret.length < 32) {
    throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters.");
  }

  return {
    clientId: required("COGNITO_CLIENT_ID"),
    issuerBaseUrl,
    logoutUri: required("AUTH_LOGOUT_URI"),
    redirectUri: required("AUTH_REDIRECT_URI"),
    sessionSecret,
  };
}
