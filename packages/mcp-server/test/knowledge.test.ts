import assert from "node:assert/strict";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { readKnowledge, searchKnowledge } from "../src/knowledge.js";

async function fixture(): Promise<AppConfig> {
  const root = join(tmpdir(), `ventneuf-mcp-test-${crypto.randomUUID()}`);
  const shared = join(root, "ventneuf");
  const personal = join(root, "personal");
  await mkdir(join(shared, "20 Projects"), { recursive: true });
  await mkdir(personal, { recursive: true });
  await writeFile(join(shared, "20 Projects", "Ampel.md"), "# Ampel\nArchitecture API\n");
  await writeFile(join(personal, "Journal.md"), "# Journal\nPrivate decision\n");
  return {
    identity: "test-user",
    vaults: { shared, personal },
    missionsFile: join(root, "missions.json"),
  };
}

test("searches both authorized vaults", async () => {
  const config = await fixture();
  const results = await searchKnowledge(config, "Ampel", ["shared", "personal"]);
  assert.equal(results.length, 1);
  assert.equal(results[0]?.path, join("20 Projects", "Ampel.md"));
});

test("reads Markdown but refuses hidden paths and symlinks", async () => {
  const config = await fixture();
  const note = await readKnowledge(config, "shared", "20 Projects/Ampel.md");
  assert.match(note.content, /Architecture API/);
  await assert.rejects(() => readKnowledge(config, "shared", ".obsidian/config.md"));

  const outside = join(tmpdir(), `ventneuf-secret-${crypto.randomUUID()}.md`);
  const link = join(config.vaults.shared, "outside.md");
  await writeFile(outside, "secret");
  await symlink(outside, link);
  await assert.rejects(() => readKnowledge(config, "shared", "outside.md"));
});
