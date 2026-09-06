import {
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ForgotPasswordCommand,
  GetUserCommand,
  GlobalSignOutCommand,
  InitiateAuthCommand,
  RespondToAuthChallengeCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
  type ChallengeNameType,
} from "@aws-sdk/client-cognito-identity-provider";
import type { AuthConfig } from "./config";
import type { AuthChallengeState } from "./challenge";

interface AuthResponse {
  AuthenticationResult?: AuthenticationResultType;
  ChallengeName?: ChallengeNameType;
  ChallengeParameters?: Record<string, string>;
  Session?: string;
}

export interface AuthTokens {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export type NativeAuthOutcome =
  | { kind: "authenticated"; tokens: AuthTokens }
  | { kind: "challenge"; state: AuthChallengeState; step: "totp" | "new-password" }
  | { kind: "challenge"; secretCode: string; state: AuthChallengeState; step: "setup-totp" };

export interface AuthenticatedIdentity {
  email: string;
  sub: string;
}

export interface PublicCognitoError {
  code: string;
  message: string;
  status: number;
}

const clients = new Map<string, CognitoIdentityProviderClient>();

function client(region: string): CognitoIdentityProviderClient {
  const existing = clients.get(region);
  if (existing) return existing;
  const created = new CognitoIdentityProviderClient({ region });
  clients.set(region, created);
  return created;
}

function errorName(error: unknown): string {
  return error && typeof error === "object" && "name" in error ? String(error.name) : "";
}

function requiredAttributes(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function tokens(result: AuthenticationResultType | undefined): AuthTokens | null {
  if (!result?.AccessToken || !result.RefreshToken || !result.ExpiresIn) return null;
  return {
    accessToken: result.AccessToken,
    expiresIn: result.ExpiresIn,
    refreshToken: result.RefreshToken,
  };
}

async function interpret(
  config: AuthConfig,
  username: string,
  response: AuthResponse,
): Promise<NativeAuthOutcome> {
  const authenticated = tokens(response.AuthenticationResult);
  if (authenticated) return { kind: "authenticated", tokens: authenticated };

  if (!response.ChallengeName || !response.Session) {
    throw new Error("Cognito returned neither authentication tokens nor a supported challenge.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  if (response.ChallengeName === "SOFTWARE_TOKEN_MFA") {
    return {
      kind: "challenge",
      state: { challenge: response.ChallengeName, issuedAt, session: response.Session, username },
      step: "totp",
    };
  }

  if (response.ChallengeName === "NEW_PASSWORD_REQUIRED") {
    return {
      kind: "challenge",
      state: {
        challenge: response.ChallengeName,
        issuedAt,
        requiredAttributes: requiredAttributes(response.ChallengeParameters?.requiredAttributes),
        session: response.Session,
        username,
      },
      step: "new-password",
    };
  }

  if (response.ChallengeName === "MFA_SETUP") {
    const associated = await client(config.region).send(
      new AssociateSoftwareTokenCommand({ Session: response.Session }),
    );
    if (!associated.SecretCode || !associated.Session) {
      throw new Error("Cognito did not return a TOTP setup secret.");
    }
    return {
      kind: "challenge",
      secretCode: associated.SecretCode,
      state: {
        challenge: response.ChallengeName,
        issuedAt,
        session: associated.Session,
        username,
      },
      step: "setup-totp",
    };
  }

  throw new Error(`Unsupported Cognito challenge: ${response.ChallengeName}`);
}

export async function beginNativeSignIn(
  config: AuthConfig,
  email: string,
  password: string,
): Promise<NativeAuthOutcome> {
  const response = await client(config.region).send(
    new InitiateAuthCommand({
      AuthFlow: "USER_PASSWORD_AUTH",
      AuthParameters: { PASSWORD: password, USERNAME: email },
      ClientId: config.clientId,
    }),
  );
  return interpret(config, email, response);
}

export async function completeNativeChallenge(
  config: AuthConfig,
  state: AuthChallengeState,
  answer: string,
): Promise<NativeAuthOutcome> {
  let response: AuthResponse;

  if (state.challenge === "SOFTWARE_TOKEN_MFA") {
    response = await client(config.region).send(
      new RespondToAuthChallengeCommand({
        ChallengeName: state.challenge,
        ChallengeResponses: { SOFTWARE_TOKEN_MFA_CODE: answer, USERNAME: state.username },
        ClientId: config.clientId,
        Session: state.session,
      }),
    );
  } else if (state.challenge === "NEW_PASSWORD_REQUIRED") {
    const challengeResponses: Record<string, string> = {
      NEW_PASSWORD: answer,
      USERNAME: state.username,
    };
    for (const attribute of state.requiredAttributes ?? []) {
      if (attribute !== "userAttributes.email") {
        throw new Error(`Unsupported required Cognito attribute: ${attribute}`);
      }
      challengeResponses[attribute] = state.username;
    }
    response = await client(config.region).send(
      new RespondToAuthChallengeCommand({
        ChallengeName: state.challenge,
        ChallengeResponses: challengeResponses,
        ClientId: config.clientId,
        Session: state.session,
      }),
    );
  } else {
    const verified = await client(config.region).send(
      new VerifySoftwareTokenCommand({
        FriendlyDeviceName: "ventneuf.os",
        Session: state.session,
        UserCode: answer,
      }),
    );
    if (verified.Status !== "SUCCESS" || !verified.Session) {
      throw new Error("Cognito did not verify the TOTP setup.");
    }
    response = await client(config.region).send(
      new RespondToAuthChallengeCommand({
        ChallengeName: "MFA_SETUP",
        ChallengeResponses: { USERNAME: state.username },
        ClientId: config.clientId,
        Session: verified.Session,
      }),
    );
  }

  return interpret(config, state.username, response);
}

export async function authenticatedIdentity(
  config: AuthConfig,
  accessToken: string,
): Promise<AuthenticatedIdentity> {
  const response = await client(config.region).send(new GetUserCommand({ AccessToken: accessToken }));
  const attributes = new Map(response.UserAttributes?.map(({ Name, Value }) => [Name, Value]));
  const sub = attributes.get("sub");
  const email = attributes.get("email");
  if (!sub || !email) throw new Error("Cognito did not return a valid identity.");
  return { email, sub };
}

export async function requestPasswordReset(config: AuthConfig, email: string): Promise<void> {
  try {
    await client(config.region).send(
      new ForgotPasswordCommand({ ClientId: config.clientId, Username: email }),
    );
  } catch (error) {
    if (["InvalidParameterException", "UserNotFoundException"].includes(errorName(error))) return;
    throw error;
  }
}

export async function confirmPasswordReset(
  config: AuthConfig,
  email: string,
  code: string,
  password: string,
): Promise<void> {
  await client(config.region).send(
    new ConfirmForgotPasswordCommand({
      ClientId: config.clientId,
      ConfirmationCode: code,
      Password: password,
      Username: email,
    }),
  );
}

export async function revokeAccess(config: AuthConfig, accessToken: string): Promise<void> {
  try {
    await client(config.region).send(new GlobalSignOutCommand({ AccessToken: accessToken }));
  } catch {
    // Local logout must still succeed when the token is expired or Cognito is unavailable.
  }
}

export function publicCognitoError(error: unknown): PublicCognitoError {
  switch (errorName(error)) {
    case "CodeMismatchException":
      return { code: "invalid_code", message: "The verification code is incorrect.", status: 400 };
    case "ExpiredCodeException":
      return { code: "expired_code", message: "The verification code has expired.", status: 400 };
    case "InvalidPasswordException":
      return {
        code: "invalid_password",
        message: "Use at least 12 characters with uppercase, lowercase, a number, and a symbol.",
        status: 400,
      };
    case "NotAuthorizedException":
    case "UserNotFoundException":
      return { code: "invalid_credentials", message: "Email or password is incorrect.", status: 401 };
    case "PasswordResetRequiredException":
      return { code: "password_reset_required", message: "Reset your password to continue.", status: 409 };
    case "TooManyFailedAttemptsException":
    case "TooManyRequestsException":
    case "LimitExceededException":
      return { code: "rate_limited", message: "Too many attempts. Wait a moment and try again.", status: 429 };
    default:
      console.error(`[auth] Cognito request failed: ${errorName(error) || "unknown error"}`);
      return { code: "auth_unavailable", message: "Sign in is temporarily unavailable.", status: 502 };
  }
}
