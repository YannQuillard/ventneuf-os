import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { AppConfig } from "../src/config.js";
import { getMission, reportMissionProgress } from "../src/missions.js";

test("persists mission progress", async () => {
  const root = join(tmpdir(), `ventneuf-mission-test-${crypto.randomUUID()}`);
  const config: AppConfig = {
    identity: "test-user",
    vaults: { shared: root, personal: root },
    missionsFile: join(root, "missions.json"),
  };
  await reportMissionProgress(config, "ampel-1", "running", "Audit in progress");
  await reportMissionProgress(config, "ampel-1", "completed", "Audit completed");
  const mission = await getMission(config, "ampel-1");
  assert.equal(mission?.status, "completed");
  assert.equal(mission?.events.length, 2);
});
