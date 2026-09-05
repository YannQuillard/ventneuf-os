import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./authentication.js";
import { createHermesClient } from "./hermes.js";
import { createConversationRuntime } from "./runtime.js";
import { createMissionDelegation } from "./mission-delegation.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const hermes = createHermesClient();
const delegations = createMissionDelegation();
const conversations = await createConversationRuntime(hermes, process.env, delegations);
const workerController = new AbortController();
const server = createServer(createApp({
  verifier: createTokenVerifier(),
  hermes,
  conversations,
  delegations,
  host,
}));

void conversations.worker.run(workerController.signal);

server.listen(port, host, () => {
  console.log(`ventneuf.os control plane listening on http://${host}:${port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  workerController.abort();
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
    void conversations.database.close();
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
