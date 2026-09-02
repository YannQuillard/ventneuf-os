import assert from "node:assert/strict";
import { createServer, get } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";

test("accepts platform health checks when listening on all interfaces", async () => {
  const app = createApp({
    host: "0.0.0.0",
    verifier: { verify: async () => undefined },
    hermes: {
      ask: async () => ({ contextId: "unused", text: "unused" }),
    },
  });
  const server = createServer(app);

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address === "object");

    const response = await new Promise<{ body: string; statusCode?: number }>(
      (resolve, reject) => {
        get(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/health",
            headers: { host: "10.0.0.42:8787" },
          },
          (incoming) => {
            let body = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk) => {
              body += chunk;
            });
            incoming.on("end", () => resolve({ body, statusCode: incoming.statusCode }));
          },
        ).on("error", reject);
      },
    );

    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.body), {
      service: "ventneuf-os-control-plane",
      status: "ok",
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
