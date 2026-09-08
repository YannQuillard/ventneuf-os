import assert from "node:assert/strict";
import { opendir, readFile } from "node:fs/promises";
import test from "node:test";

test("runner release source has no runtime workspace-package imports", async () => {
  const sourceDirectory = new URL("../src/", import.meta.url);
  const directory = await opendir(sourceDirectory);
  for await (const entry of directory) {
    if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
    const source = await readFile(new URL(entry.name, sourceDirectory), "utf8");
    for (const statement of source.split(";")) {
      if (!/from\s+["']@ventneuf\//.test(statement)) continue;
      assert.match(statement, /^\s*import\s+type\b/,
        `src/${entry.name} must not import runtime code from a workspace package.`);
    }
  }
});
