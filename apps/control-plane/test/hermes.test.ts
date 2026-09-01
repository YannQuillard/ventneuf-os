import assert from "node:assert/strict";
import { test } from "node:test";
import { A2AHermesClient, StaticTokenProvider } from "../src/hermes.js";

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
