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
    env: { ...process.env, ...(isCi ? {} : { NEXT_DIST_DIR: ".next-playwright" }),
      AUTH_SESSION_SECRET: "browser-tests-only-session-secret-00000000",
      COGNITO_DOMAIN: "https://browser-tests.auth.eu-west-1.amazoncognito.com", COGNITO_CLIENT_ID: "browser-tests",
      AUTH_REDIRECT_URI: "http://127.0.0.1:3100/api/auth/callback", AUTH_LOGOUT_URI: "http://127.0.0.1:3100/login",
    },
    url: "http://127.0.0.1:3100/prototype/c/hermes",
    timeout: 120_000,
    reuseExistingServer: !isCi,
  },
});
