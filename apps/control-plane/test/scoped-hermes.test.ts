import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { ScopedHermesClient } from "../src/scoped-hermes.js";
import { createHermesClient, StaticTokenProvider } from "../src/hermes.js";

const personal = "a".repeat(64);
const shared = "b".repeat(64);

test("scoped Hermes binds provisioning, execution and cancellation to the resolved profile", async () => {
  const requests: Array<{ path: string; method: string; authorization: string | null }> = [];
  const token = randomBytes(32).toString("hex");
  const client = new ScopedHermesClient("http://scope-gateway.invalid", new StaticTokenProvider(token), async (input, init) => {
    const path = new URL(String(input)).pathname;
    requests.push({ path, method: init?.method ?? "GET", authorization: new Headers(init?.headers).get("authorization") });
    if (path.endsWith("/events")) return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
    if (path.endsWith("/v1/runs") && init?.method === "POST") return Response.json({ run_id: "run-1" });
    if (path.endsWith("/v1/runs/run-1")) return Response.json({ run_id: "run-1", status: "completed", output: "Scoped reply", session_id: "scoped-session" });
    return Response.json({ ready: true });
  });
  const reply = await client.ask({ message: "Remember this decision", scopeId: shared });
  assert.equal(reply.text, "Scoped reply");
  await client.stop("run-1", shared);
  assert.ok(requests.length >= 4);
  assert.equal(requests.every(request => request.path.startsWith(`/scopes/${shared}`)), true);
  assert.equal(requests.every(request => request.authorization === `Bearer ${token}`), true);
  const before = requests.length;
  await assert.rejects(client.ask({ message: "No resolved audience" }), /scope is required/);
  await assert.rejects(client.listMemory("../personal"));
  assert.equal(requests.length, before);
});

test("memory browsing stays in the selected authorized scope and hides upstream error bodies", async () => {
  const requests: string[] = [];
  const client = new ScopedHermesClient("http://scope-gateway.invalid/", new StaticTokenProvider(randomBytes(32).toString("hex")), async input => {
    const path = new URL(String(input)).pathname;
    requests.push(path);
    if (path === `/scopes/${personal}/notes`) return Response.json({ entries: [{ id: "decision", title: "Decision", path: "decisions.md", updatedAt: new Date().toISOString() }] });
    return new Response("Sensitive upstream configuration", { status: 503 });
  });
  assert.equal((await client.listMemory(personal)).entries[0]?.title, "Decision");
  await assert.rejects(client.readMemory(shared, "decision"), error => {
    assert.equal((error as Error).message, "The scoped Hermes workspace is temporarily unavailable.");
    return true;
  });
  assert.deepEqual(requests, [`/scopes/${personal}/notes`, `/scopes/${shared}/notes/decision`]);
});

test("production scoped routing never falls back to a personal profile or inline secret", () => {
  assert.throws(() => createHermesClient({ NODE_ENV: "production", HERMES_API_URL: "http://legacy.invalid", HERMES_API_SECRET_ID: "legacy" }), /SCOPE_GATEWAY_URL/);
  assert.throws(() => createHermesClient({ NODE_ENV: "production", HERMES_SCOPE_GATEWAY_URL: "http://scope-gateway.invalid",
    HERMES_SCOPE_GATEWAY_TOKEN: randomBytes(32).toString("hex"), HERMES_API_URL: "http://legacy.invalid", HERMES_API_SECRET_ID: "legacy" }), /SCOPE_GATEWAY_SECRET_ID/);
});

test("native polling stops a scope whose audience was withdrawn before any result is consumed", async () => {
  const paths: string[] = [];
  const client = new ScopedHermesClient("http://scope-gateway.invalid", new StaticTokenProvider(randomBytes(32).toString("hex")), async (input, init) => {
    const path = new URL(String(input)).pathname;
    paths.push(path);
    if (path.endsWith("/v1/runs") && init?.method === "POST") return Response.json({ run_id: "retired-run" });
    return Response.json({ ready: true });
  });
  await assert.rejects(client.ask({ message: "Authorized before the audience changed", scopeId: personal,
    shouldStop: async () => true }), /cancelled/);
  assert.ok(paths.some(path => path.endsWith("/v1/runs/retired-run/stop")));
  assert.equal(paths.some(path => path.endsWith("/v1/runs/retired-run")), false);
});

test("scope provisioning timeouts explain workspace unavailability without submitting a run", async () => {
  let requests = 0;
  const client = new ScopedHermesClient("http://scope-gateway.invalid", new StaticTokenProvider("test-token"), async () => {
    requests += 1;
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });
  await assert.rejects(client.ask({ message: "Hello", scopeId: shared }), /Hermes workspace did not respond in time/);
  assert.equal(requests, 1);
});
