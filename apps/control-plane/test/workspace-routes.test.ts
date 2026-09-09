import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { WorkspaceAccessError } from "@ventneuf/database";
import { createApp } from "../src/app.js";
import type { ConversationRuntime } from "../src/runtime.js";

const conversationId = "00000000-0000-4000-8000-000000000010";
const organizationId = "00000000-0000-4000-8000-000000000001";

async function serve(runtime: Partial<ConversationRuntime>) {
  const server = createServer(createApp({
    verifier: { verify: async token => token === "missing" ? undefined : ({
      principalType: token === "service" ? "service" : "user",
      principalId: token, organizationId, capabilities: ["hermes:ask"], projectIds: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    }) },
    hermes: { ask: async () => { throw new Error("Web request handlers must not execute Hermes."); } },
    conversations: runtime as ConversationRuntime,
  }));
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    request: (path: string, token = "alice", init: RequestInit = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    }),
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}

test("workspace APIs bind actor scope to authentication and reject client ownership overrides", async () => {
  const scopes: unknown[] = [];
  const api = await serve({ workspace: {
    listProjects: async scope => { scopes.push(scope); return []; },
    createProject: async () => { throw new Error("Malformed ownership override reached the repository."); },
    getProject: async () => { throw new WorkspaceAccessError(); },
  } as unknown as NonNullable<ConversationRuntime["workspace"]> });
  try {
    assert.equal((await api.request("/api/workspace/projects", "service")).status, 403);
    assert.equal((await api.request("/api/workspace/projects", "missing")).status, 401);
    assert.equal((await api.request("/api/workspace/projects", "alice")).status, 200);
    assert.deepEqual(scopes, [{ organizationId, externalSubject: "alice" }]);
    assert.equal((await api.request("/api/workspace/projects", "alice", {
      method: "POST", body: JSON.stringify({ name: "Private project", ownerMemberId: "bob" }),
    })).status, 400);
    assert.equal((await api.request(`/api/workspace/projects/${conversationId}`)).status, 404);
  } finally { await api.close(); }
});

test("workspace messages are queued in the specified conversation and cannot attach arbitrary runner missions", async () => {
  let accepted: Record<string, unknown> | undefined;
  let group: string | undefined;
  const api = await serve({
    workspace: {} as NonNullable<ConversationRuntime["workspace"]>,
    repository: {
      enqueuePrivateMessage: async input => {
        accepted = input;
        return { conversationId, message: { createdAt: new Date() }, mission: { id: "queued-mission", status: "queued", context: {} } };
      },
      setMissionQueued: async () => undefined,
    } as unknown as ConversationRuntime["repository"],
    queue: { publish: async (_envelope, conversation) => { group = conversation; } } as ConversationRuntime["queue"],
  });
  try {
    const response = await api.request(`/api/workspace/conversations/${conversationId}/messages`, "alice", {
      method: "POST", body: JSON.stringify({ content: "Remember the project decision." }),
    });
    assert.equal(response.status, 202);
    assert.equal(accepted?.conversationId, conversationId);
    assert.equal(accepted?.externalSubject, "alice");
    assert.equal(group, conversationId);
    assert.equal((await api.request(`/api/workspace/conversations/${conversationId}/messages`, "alice", {
      method: "POST", body: JSON.stringify({ content: "Hello", missionId: conversationId }),
    })).status, 400);
  } finally { await api.close(); }
});

test("project chat queues an asynchronous Hermes reply in the same conversation", async () => {
  let accepted: Record<string, unknown> | undefined;
  let group: string | undefined;
  const api = await serve({
    workspace: {
      getConversation: async () => ({ isProjectGeneral: true }),
      appendProjectMessage: async (_scope, _id, content) => ({ content }),
    } as unknown as NonNullable<ConversationRuntime["workspace"]>,
    repository: {
      enqueuePrivateMessage: async input => {
        accepted = input;
        return { conversationId, message: { createdAt: new Date() }, mission: { id: "queued-mission", status: "queued", context: {} } };
      },
      setMissionQueued: async () => undefined,
    } as unknown as ConversationRuntime["repository"],
    queue: { publish: async (_envelope, conversation) => { group = conversation; } } as ConversationRuntime["queue"],
  });
  try {
    for (const content of ["Help improve this project.", "@hermes-other hello", "person@hermes.com"]) {
      const response = await api.request(`/api/workspace/conversations/${conversationId}/messages`, "alice", {
        method: "POST", body: JSON.stringify({ content, delivery: "project_chat" }),
      });
      assert.equal(response.status, 201);
      assert.equal(accepted, undefined);
      assert.equal(group, undefined);
    }

    const response = await api.request(`/api/workspace/conversations/${conversationId}/messages`, "alice", {
      method: "POST", body: JSON.stringify({ content: "@Hermes, help improve this project.", delivery: "project_chat" }),
    });
    assert.equal(response.status, 202);
    assert.equal(accepted?.conversationId, conversationId);
    assert.equal(accepted?.externalSubject, "alice");
    assert.equal(group, conversationId);
    assert.equal((await api.request(`/api/workspace/conversations/${conversationId}/messages`, "alice", {
      method: "POST", body: JSON.stringify({ content: "Hello", missionId: conversationId }),
    })).status, 400);
  } finally { await api.close(); }
});

test("an open conversation stream stops disclosing snapshots after access is revoked", async () => {
  let reads = 0;
  const api = await serve({
    workspace: {} as NonNullable<ConversationRuntime["workspace"]>,
    repository: { getConversationSnapshot: async input => {
      assert.equal(input.conversationId, conversationId);
      if (++reads > 1) throw new WorkspaceAccessError();
      return { messages: [{ content: "Visible before revocation" }] };
    } } as unknown as ConversationRuntime["repository"],
  });
  try {
    const response = await api.request(`/api/workspace/conversations/${conversationId}/events`);
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.equal(text.match(/event: snapshot/g)?.length, 1);
    assert.match(text, /event: access_revoked/);
    assert.equal(reads, 2);
  } finally { await api.close(); }
});
