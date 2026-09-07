import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { DecryptCommand, EncryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import type { GitHubConnectionRepository, WorkspaceScope } from "@ventneuf/database";

interface GitHubAppConfiguration {
  clientId: string;
  clientSecret: string;
  slug: string;
  stateSecret: string;
}

interface StoredCredential {
  accessToken: string;
  refreshToken?: string;
  accessTokenExpiresAt?: string;
  refreshTokenExpiresAt?: string;
}

interface TokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  refresh_token_expires_in?: unknown;
  error?: unknown;
}

interface GitHubUser { id?: unknown; login?: unknown }
interface GitHubInstallation { id?: unknown }
interface GitHubRepositoryPayload {
  id?: unknown;
  name?: unknown;
  full_name?: unknown;
  private?: unknown;
  html_url?: unknown;
  clone_url?: unknown;
  owner?: { login?: unknown };
}

type Fetch = typeof fetch;

export interface GitHubRepositoryView {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  private: boolean;
  htmlUrl: string;
  cloneUrl: string;
}

export interface GitHubConnector {
  status(scope: WorkspaceScope): Promise<{ connected: boolean; login?: string; installUrl: string }>;
  authorizationUrl(scope: WorkspaceScope): Promise<string>;
  complete(scope: WorkspaceScope, code: string, state: string): Promise<void>;
  repositories(scope: WorkspaceScope): Promise<GitHubRepositoryView[]>;
  disconnect(scope: WorkspaceScope): Promise<void>;
}

class GitHubCredentialCipher {
  constructor(private readonly kms: KMSClient, private readonly keyId: string) {}

  async encrypt(scope: WorkspaceScope, credential: StoredCredential) {
    const result = await this.kms.send(new EncryptCommand({
      KeyId: this.keyId,
      Plaintext: Buffer.from(JSON.stringify(credential)),
      EncryptionContext: { organizationId: scope.organizationId, externalSubject: scope.externalSubject },
    }));
    if (!result.CiphertextBlob) throw new Error("GitHub credential encryption failed.");
    return Buffer.from(result.CiphertextBlob).toString("base64");
  }

  async decrypt(scope: WorkspaceScope, ciphertext: string): Promise<StoredCredential> {
    const result = await this.kms.send(new DecryptCommand({
      KeyId: this.keyId,
      CiphertextBlob: Buffer.from(ciphertext, "base64"),
      EncryptionContext: { organizationId: scope.organizationId, externalSubject: scope.externalSubject },
    }));
    if (!result.Plaintext) throw new Error("GitHub credential decryption failed.");
    const value = JSON.parse(Buffer.from(result.Plaintext).toString("utf8")) as StoredCredential;
    if (!value.accessToken || typeof value.accessToken !== "string") throw new Error("The GitHub credential is invalid.");
    return value;
  }
}

export class ManagedGitHubConnector implements GitHubConnector {
  constructor(
    private readonly connections: Pick<GitHubConnectionRepository, "get" | "save" | "remove">,
    private readonly configuration: () => Promise<GitHubAppConfiguration>,
    private readonly cipher: Pick<GitHubCredentialCipher, "encrypt" | "decrypt">,
    private readonly callbackUrl: string,
    private readonly request: Fetch = fetch,
  ) {}

  private async config() {
    const config = await this.configuration();
    if (!config.clientId || !config.clientSecret || !/^[a-zA-Z0-9-]+$/.test(config.slug)
      || Buffer.byteLength(config.stateSecret) < 32) throw new Error("The GitHub App configuration is incomplete.");
    return config;
  }

  private async state(scope: WorkspaceScope) {
    const config = await this.config();
    const payload = Buffer.from(JSON.stringify({ ...scope, expiresAt: Date.now() + 10 * 60_000,
      nonce: randomBytes(16).toString("hex") })).toString("base64url");
    const signature = createHmac("sha256", config.stateSecret).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  private async verifyState(scope: WorkspaceScope, value: string) {
    const [payload, signature, extra] = value.split(".");
    if (!payload || !signature || extra) return false;
    const config = await this.config();
    const expected = Buffer.from(createHmac("sha256", config.stateSecret).update(payload).digest("base64url"));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
    try {
      const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
      return parsed.organizationId === scope.organizationId && parsed.externalSubject === scope.externalSubject
        && typeof parsed.expiresAt === "number" && parsed.expiresAt > Date.now();
    } catch { return false; }
  }

  async status(scope: WorkspaceScope) {
    const [connection, config] = await Promise.all([this.connections.get(scope), this.config()]);
    const installUrl = new URL(`https://github.com/apps/${config.slug}/installations/new`);
    installUrl.searchParams.set("state", await this.state(scope));
    return { connected: Boolean(connection), ...(connection ? { login: connection.login } : {}),
      installUrl: installUrl.toString() };
  }

  async authorizationUrl(scope: WorkspaceScope) {
    const config = await this.config();
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("redirect_uri", this.callbackUrl);
    url.searchParams.set("state", await this.state(scope));
    return url.toString();
  }

  private async exchange(parameters: URLSearchParams): Promise<StoredCredential> {
    const config = await this.config();
    parameters.set("client_id", config.clientId);
    parameters.set("client_secret", config.clientSecret);
    const response = await this.request("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
      body: parameters,
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json() as TokenResponse;
    if (!response.ok || typeof payload.access_token !== "string") throw new Error("GitHub authorization failed.");
    const now = Date.now();
    return {
      accessToken: payload.access_token,
      ...(typeof payload.refresh_token === "string" ? { refreshToken: payload.refresh_token } : {}),
      ...(typeof payload.expires_in === "number" ? { accessTokenExpiresAt: new Date(now + payload.expires_in * 1_000).toISOString() } : {}),
      ...(typeof payload.refresh_token_expires_in === "number"
        ? { refreshTokenExpiresAt: new Date(now + payload.refresh_token_expires_in * 1_000).toISOString() } : {}),
    };
  }

  private async api<T>(path: string, accessToken: string): Promise<T> {
    const response = await this.request(new URL(path, "https://api.github.com"), {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`,
        "user-agent": "ventneuf-os", "x-github-api-version": "2026-03-10" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("GitHub is unavailable or access was revoked.");
    return response.json() as Promise<T>;
  }

  async complete(scope: WorkspaceScope, code: string, state: string) {
    if (!await this.verifyState(scope, state)) throw new Error("The GitHub authorization state is invalid or expired.");
    const credential = await this.exchange(new URLSearchParams({ code, redirect_uri: this.callbackUrl }));
    const user = await this.api<GitHubUser>("/user", credential.accessToken);
    if ((typeof user.id !== "number" && typeof user.id !== "string") || typeof user.login !== "string" || !user.login) {
      throw new Error("GitHub returned an invalid user identity.");
    }
    await this.connections.save(scope, {
      githubUserId: String(user.id),
      login: user.login,
      credentialCiphertext: await this.cipher.encrypt(scope, credential),
    });
  }

  private async credential(scope: WorkspaceScope) {
    const connection = await this.connections.get(scope);
    if (!connection) throw new Error("Connect GitHub before listing repositories.");
    let credential = await this.cipher.decrypt(scope, connection.credentialCiphertext);
    if (credential.accessTokenExpiresAt && Date.parse(credential.accessTokenExpiresAt) <= Date.now() + 60_000) {
      if (!credential.refreshToken || (credential.refreshTokenExpiresAt
        && Date.parse(credential.refreshTokenExpiresAt) <= Date.now())) throw new Error("Reconnect GitHub to continue.");
      credential = await this.exchange(new URLSearchParams({ grant_type: "refresh_token", refresh_token: credential.refreshToken }));
      await this.connections.save(scope, { githubUserId: connection.githubUserId, login: connection.login,
        credentialCiphertext: await this.cipher.encrypt(scope, credential) });
    }
    return credential;
  }

  async repositories(scope: WorkspaceScope) {
    const credential = await this.credential(scope);
    const installations = await this.api<{ installations?: GitHubInstallation[] }>("/user/installations?per_page=100", credential.accessToken);
    const repositories: GitHubRepositoryView[] = [];
    for (const installation of installations.installations ?? []) {
      if (typeof installation.id !== "number" && typeof installation.id !== "string") continue;
      const payload = await this.api<{ repositories?: GitHubRepositoryPayload[] }>(
        `/user/installations/${encodeURIComponent(String(installation.id))}/repositories?per_page=100`,
        credential.accessToken,
      );
      for (const repository of payload.repositories ?? []) {
        if ((typeof repository.id !== "number" && typeof repository.id !== "string") || typeof repository.owner?.login !== "string"
          || typeof repository.name !== "string" || typeof repository.full_name !== "string" || typeof repository.private !== "boolean"
          || typeof repository.html_url !== "string" || typeof repository.clone_url !== "string") continue;
        repositories.push({ id: String(repository.id), owner: repository.owner.login.toLowerCase(), name: repository.name.toLowerCase(),
          fullName: repository.full_name, private: repository.private, htmlUrl: repository.html_url, cloneUrl: repository.clone_url });
      }
    }
    return [...new Map(repositories.map((repository) => [repository.id, repository])).values()]
      .sort((left, right) => left.fullName.localeCompare(right.fullName));
  }

  disconnect(scope: WorkspaceScope) { return this.connections.remove(scope); }
}

export function createGitHubConnector(connections: GitHubConnectionRepository, env = process.env): GitHubConnector | undefined {
  const secretId = env.GITHUB_APP_SECRET_ID;
  const keyId = env.GITHUB_TOKEN_KMS_KEY_ID;
  const callbackUrl = env.GITHUB_CALLBACK_URL;
  if (!secretId && !keyId && !callbackUrl) return undefined;
  if (!secretId || !keyId || !callbackUrl) throw new Error("GitHub App runtime configuration is incomplete.");
  const region = env.AWS_REGION ?? "eu-west-1";
  const secrets = new SecretsManagerClient({ region });
  let cached: Promise<GitHubAppConfiguration> | undefined;
  const configuration = () => cached ??= secrets.send(new GetSecretValueCommand({ SecretId: secretId })).then(({ SecretString }) => {
    const value = JSON.parse(SecretString ?? "{}") as GitHubAppConfiguration;
    return value;
  }).catch((error) => { cached = undefined; throw error; });
  return new ManagedGitHubConnector(connections, configuration,
    new GitHubCredentialCipher(new KMSClient({ region }), keyId), callbackUrl);
}
