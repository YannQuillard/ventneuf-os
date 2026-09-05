import assert from "node:assert/strict";
import test from "node:test";
import { tokenizeDiff } from "../lib/prototype/diff";
import { formatElapsed, formatTokens } from "../lib/prototype/format";
import { activePhaseIndex } from "../lib/prototype/presentation";

test("elapsed durations read naturally at every scale", () => {
  assert.equal(formatElapsed(420), "420 ms");
  assert.equal(formatElapsed(36_000), "36 s");
  assert.equal(formatElapsed(291_000), "4 min 51 s");
  assert.equal(formatElapsed(34 * 60_000), "34 min");
  assert.equal(formatElapsed(130 * 60_000), "2 h 10 min");
  assert.equal(formatElapsed(undefined), undefined);
});

test("token counts compress to readable magnitudes", () => {
  assert.equal(formatTokens(640), "640");
  assert.equal(formatTokens(6_200), "6.2k");
  assert.equal(formatTokens(412_800), "413k");
  assert.equal(formatTokens(1_020_000), "1.02M");
});

test("diff lines map to syntax token types by their first character", () => {
  const tokens = tokenizeDiff("--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n same");
  assert.deepEqual(tokens.map(({ type }) => type), ["keyword", "keyword", "comment", "tag", "string"]);
  assert.equal(tokens[3].start, "--- a/file\n+++ b/file\n@@ -1 +1 @@\n".length);
});

test("the active mission phase follows status and pull request presence", () => {
  assert.equal(activePhaseIndex("waiting_for_approval", false), 3);
  assert.equal(activePhaseIndex("running", false), 2);
  assert.equal(activePhaseIndex("running", true), 5);
  assert.equal(activePhaseIndex("completed", true), 6);
  assert.equal(activePhaseIndex("failed", false), 2);
});
