import assert from "node:assert/strict";
import test from "node:test";
import { proxyResponse } from "../lib/proxy-response";

test("proxies a no-content response without constructing a forbidden body", async () => {
  const response = proxyResponse(new Response(null, { status: 204 }));

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
});

test("preserves response bodies and content types", async () => {
  const response = proxyResponse(new Response('{"ok":true}', {
    status: 202,
    headers: { "content-type": "application/json; charset=utf-8" },
  }));

  assert.equal(response.status, 202);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.deepEqual(await response.json(), { ok: true });
});
