import assert from "node:assert/strict";
import { test } from "node:test";
import {
  A2AHermesClient,
  HermesRequestTimeoutError,
  RunsHermesClient,
  StaticTokenProvider,
} from "../src/hermes.js";

test("sends an authenticated A2A message and extracts the final artifact", async () => {
  let request: RequestInit | undefined;
  const fetchMock = (async (_url: string | URL | Request, init?: RequestInit) => {
    request = init;
    return Response.json({
      jsonrpc: "2.0",
      id: "request-1",
      result: {
        task: {
          id: "task-1",
          contextId: "context-1",
          status: { state: "TASK_STATE_COMPLETED" },
          artifacts: [{ parts: [{ text: "A2A_OK", mediaType: "text/plain" }] }],
        },
      },
    });
  }) as typeof fetch;
  const client = new A2AHermesClient(
    "http://127.0.0.1:9900/",
    new StaticTokenProvider("private-token"),
    fetchMock,
  );

  const result = await client.ask({ message: "test", contextId: "context-1" });

  assert.equal(result.text, "A2A_OK");
  assert.equal(result.taskId, "task-1");
  assert.equal(result.state, "TASK_STATE_COMPLETED");
  assert.equal(new Headers(request?.headers).get("authorization"), "Bearer private-token");
  assert.doesNotMatch(JSON.stringify(result), /private-token/);
});

test("starts and polls an authenticated Hermes run", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  let polls = 0;
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("/v1/runs")) {
      return Response.json({ run_id: "run-1", status: "started" }, { status: 202 });
    }
    polls += 1;
    return Response.json(polls === 1
      ? { run_id: "run-1", status: "running", session_id: "context-1" }
      : { run_id: "run-1", status: "completed", session_id: "context-1", output: "Done" });
  }) as typeof fetch;
  let persistedRunId = "";
  const client = new RunsHermesClient(
    "http://hermes.internal:8643/",
    new StaticTokenProvider("private-token"),
    fetchMock,
    0,
  );

  const result = await client.ask({
    message: "test",
    contextId: "context-1",
    sessionKey: "organization:1:conversation:1",
    onRunStarted: async (runId) => { persistedRunId = runId; },
  });

  assert.equal(persistedRunId, "run-1");
  assert.equal(result.text, "Done");
  assert.equal(result.taskId, "run-1");
  assert.equal(requests.length, 3);
  assert.equal(new Headers(requests[0]?.init?.headers).get("authorization"), "Bearer private-token");
  assert.equal(
    new Headers(requests[0]?.init?.headers).get("x-hermes-session-key"),
    "organization:1:conversation:1",
  );
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
    input: "test",
    session_id: "context-1",
  });
});

test("resumes a persisted Hermes run without submitting it again", async () => {
  const urls: string[] = [];
  const fetchMock = (async (url: string | URL | Request) => {
    urls.push(String(url));
    return Response.json({
      run_id: "run-existing",
      status: "completed",
      session_id: "context-1",
      output: "Recovered",
    });
  }) as typeof fetch;
  const client = new RunsHermesClient(
    "http://hermes.internal:8643",
    new StaticTokenProvider("private-token"),
    fetchMock,
    0,
  );

  const result = await client.ask({
    message: "must not be submitted again",
    contextId: "context-1",
    runId: "run-existing",
  });

  assert.equal(result.text, "Recovered");
  assert.deepEqual(urls, ["http://hermes.internal:8643/v1/runs/run-existing"]);
});

test("stops an authenticated Hermes run", async () => {
  let request: { url?: string; init?: RequestInit } = {};
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    request = { url: String(url), init };
    return Response.json({ status: "stopping" });
  }) as typeof fetch;
  const client = new RunsHermesClient(
    "http://hermes.internal:8643",
    new StaticTokenProvider("private-token"),
    fetchMock,
  );

  await client.stop("run-1");

  assert.equal(request.url, "http://hermes.internal:8643/v1/runs/run-1/stop");
  assert.equal(request.init?.method, "POST");
});

test("streams structured run events and sends an idempotency key", async () => {
  const events: string[] = [];
  let submissionHeaders = new Headers();
  const fetchMock = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (path.endsWith("/v1/runs")) {
      submissionHeaders = new Headers(init?.headers);
      return Response.json({ run_id: "run-1", status: "started" }, { status: 202 });
    }
    if (path.endsWith("/events")) {
      return new Response([
        'data: {"event":"tool.started","tool":"terminal"}',
        'data: {"event":"tool.completed","tool":"terminal","duration":0.5}',
        "",
      ].join("\n\n"), { headers: { "content-type": "text/event-stream" } });
    }
    return Response.json({
      run_id: "run-1",
      status: "completed",
      session_id: "context-1",
      output: "Done",
    });
  }) as typeof fetch;
  const client = new RunsHermesClient(
    "http://hermes.internal:8643",
    new StaticTokenProvider("private-token"),
    fetchMock,
    0,
  );

  await client.ask({
    message: "test",
    contextId: "context-1",
    idempotencyKey: "mission-1",
    onEvent: async (event) => { events.push(event.event); },
  });

  assert.equal(submissionHeaders.get("idempotency-key"), "mission-1");
  assert.deepEqual(events, ["tool.started", "tool.completed"]);
});

test("rejects an A2A JSON-RPC error", async () => {
  const fetchMock = (async () =>
    Response.json({
      jsonrpc: "2.0",
      id: "request-1",
      error: { code: -32001, message: "unauthorized" },
    })) as typeof fetch;
  const client = new A2AHermesClient(
    "http://127.0.0.1:9900/",
    new StaticTokenProvider("private-token"),
    fetchMock,
  );

  await assert.rejects(() => client.ask({ message: "test" }), /unauthorized/);
});

test("classifies an A2A client timeout as non-retryable", async () => {
  const fetchMock = (async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  }) as typeof fetch;
  const client = new A2AHermesClient(
    "http://127.0.0.1:9900/",
    new StaticTokenProvider("private-token"),
    fetchMock,
  );

  await assert.rejects(
    () => client.ask({ message: "test" }),
    HermesRequestTimeoutError,
  );
});
