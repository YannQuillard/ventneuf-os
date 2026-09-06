import assert from "node:assert/strict";
import test from "node:test";
import { isSameOriginMutation } from "../lib/request-security";

test("accepts a direct same-origin request", () => {
  const request = new Request("https://app.example.com/api/auth/sign-in", {
    headers: { host: "app.example.com", origin: "https://app.example.com" },
  });

  assert.equal(isSameOriginMutation(request), true);
});

test("uses trusted proxy headers to resolve the public origin", () => {
  const request = new Request("http://localhost:3000/api/auth/sign-in", {
    headers: {
      host: "localhost:3000",
      origin: "https://public.example.com",
      "x-forwarded-host": "public.example.com",
      "x-forwarded-proto": "https",
    },
  });

  assert.equal(isSameOriginMutation(request), true);
});

test("rejects missing, malformed, and cross-origin request origins", () => {
  assert.equal(isSameOriginMutation(new Request("https://app.example.com/api/auth/sign-in")), false);
  assert.equal(
    isSameOriginMutation(
      new Request("https://app.example.com/api/auth/sign-in", {
        headers: { host: "app.example.com", origin: "null" },
      }),
    ),
    false,
  );
  assert.equal(
    isSameOriginMutation(
      new Request("https://app.example.com/api/auth/sign-in", {
        headers: { host: "app.example.com", origin: "https://attacker.example" },
      }),
    ),
    false,
  );
});
