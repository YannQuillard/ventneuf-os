import assert from "node:assert/strict";
import test from "node:test";
import { ManagedGitHubConnector } from "../src/github.js";

test("binds GitHub authorization and repository discovery to one member", async () => {
  const scope = { organizationId: "00000000-0000-4000-8000-000000000001", externalSubject: "member-a" };
  let connection: { organizationId: string; memberId: string; githubUserId: string; login: string;
    credentialCiphertext: string; createdAt: Date; updatedAt: Date } | undefined;
  const connections = {
    get: async (requested: typeof scope) => requested.externalSubject === scope.externalSubject ? connection : undefined,
    save: async (_requested: typeof scope, input: { githubUserId: string; login: string; credentialCiphertext: string }) => {
      connection = { organizationId: scope.organizationId, memberId: "member-id", ...input, createdAt: new Date(), updatedAt: new Date() };
      return connection;
    },
    remove: async () => { connection = undefined; },
  };
  const cipher = {
    encrypt: async (_requested: typeof scope, credential: unknown) => Buffer.from(JSON.stringify(credential)).toString("base64"),
    decrypt: async (_requested: typeof scope, ciphertext: string) => JSON.parse(Buffer.from(ciphertext, "base64").toString("utf8")),
  };
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://github.com/login/oauth/access_token") {
      assert.match(String(init?.body), /code=github-code/);
      return Response.json({ access_token: "member-token" });
    }
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer member-token");
    if (url.endsWith("/user")) return Response.json({ id: 42, login: "mateo" });
    if (url.includes("/user/installations?")) return Response.json({ installations: [{ id: 7 }] });
    if (url.includes("/user/installations/7/repositories")) return Response.json({ repositories: [{
      id: 99,
      name: "Personal",
      full_name: "mateo/Personal",
      private: true,
      html_url: "https://github.com/mateo/Personal",
      clone_url: "https://github.com/mateo/Personal.git",
      owner: { login: "Mateo" },
    }] });
    return new Response(undefined, { status: 404 });
  };
  const connector = new ManagedGitHubConnector(connections, async () => ({
    clientId: "client-id",
    clientSecret: "client-secret",
    slug: "ventneuf-os",
    stateSecret: "s".repeat(32),
  }), cipher, "https://app.example.com/api/github/callback", request as typeof fetch);

  const authorizationUrl = new URL(await connector.authorizationUrl(scope));
  const state = authorizationUrl.searchParams.get("state")!;
  await assert.rejects(connector.complete({ ...scope, externalSubject: "member-b" }, "github-code", state), /state is invalid/);
  await connector.complete(scope, "github-code", state);
  const status = await connector.status(scope);
  assert.equal(status.connected, true);
  assert.equal(status.login, "mateo");
  const installUrl = new URL(status.installUrl);
  assert.equal(`${installUrl.origin}${installUrl.pathname}`, "https://github.com/apps/ventneuf-os/installations/new");
  const installState = installUrl.searchParams.get("state");
  assert.ok(installState);
  await assert.rejects(connector.complete({ ...scope, externalSubject: "member-b" }, "github-code", installState), /state is invalid/);
  assert.deepEqual(await connector.repositories(scope), [{
    id: "99",
    owner: "mateo",
    name: "personal",
    fullName: "mateo/Personal",
    private: true,
    htmlUrl: "https://github.com/mateo/Personal",
    cloneUrl: "https://github.com/mateo/Personal.git",
  }]);
});
