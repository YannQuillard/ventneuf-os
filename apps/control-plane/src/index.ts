import { createServer } from "node:http";
import { createApp } from "./app.js";
import { createTokenVerifier } from "./authentication.js";

const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const server = createServer(createApp(createTokenVerifier()));

server.listen(port, host, () => {
  console.log(`ventneuf.os control plane listening on http://${host}:${port}`);
});

function shutdown(signal: string) {
  console.log(`Received ${signal}; shutting down.`);
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
