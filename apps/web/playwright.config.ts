import { defineConfig } from "@playwright/test";

const isCi = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./test/browser",
  timeout: 15_000,
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    channel: isCi ? undefined : "chrome",
  },
  webServer: {
    command: isCi
      ? "npm run start -- --hostname 127.0.0.1 --port 3100"
      : "npm run dev -- --hostname 127.0.0.1 --port 3100",
    cwd: ".",
    env: isCi ? undefined : { ...process.env, NEXT_DIST_DIR: ".next-playwright" },
    url: "http://127.0.0.1:3100/prototype/c/hermes",
    timeout: 120_000,
    reuseExistingServer: !isCi,
  },
});
