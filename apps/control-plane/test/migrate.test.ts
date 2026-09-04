import assert from "node:assert/strict";
import test from "node:test";
import { buildDatabaseUrl } from "../src/migrate.js";

test("builds a TLS-required database URL without losing reserved characters", () => {
  const password = ["reserved", "characters", "and space"].join("/?#");
  const url = new URL(buildDatabaseUrl(
    "database.internal",
    "ventneuf_os",
    { username: "migration_test", password },
  ));

  assert.equal(url.username, "migration_test");
  assert.equal(decodeURIComponent(url.password), password);
  assert.equal(url.hostname, "database.internal");
  assert.equal(url.pathname, "/ventneuf_os");
  assert.equal(url.searchParams.get("sslmode"), "require");
});
