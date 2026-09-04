import assert from "node:assert/strict";
import test from "node:test";
import { missionActivities, toolLabel } from "../lib/mission-activity";
import type { MissionEvent } from "../lib/conversations";

function event(
  id: string,
  type: string,
  tool: string,
  payload: Record<string, unknown> = {},
): MissionEvent {
  return {
    id,
    missionId: "mission-1",
    type,
    payload: { tool, ...payload },
    occurredAt: "2026-09-04T09:34:00.000Z",
  };
}

test("turns MCP identifiers into compact readable labels", () => {
  assert.equal(
    toolLabel("mcp__ventneuf_vault__read_text_file"),
    "Ventneuf vault · Read text file",
  );
  assert.equal(toolLabel("skill_view"), "Skill view");
});

test("pairs tool lifecycle events and preserves their first-seen order", () => {
  const events = [
    event("start-1", "tool.started", "skill_view", { preview: "ventneuf-knowledge" }),
    event("start-2", "tool.started", "tool_describe"),
    event("complete-1", "tool.completed", "skill_view", { duration: 0.065, error: false }),
    event("complete-2", "tool.completed", "tool_describe", { duration: 0.04, error: true }),
    event("ignored", "run.completed", "run"),
  ];

  assert.deepEqual(missionActivities(events), [
    {
      id: "start-1",
      tool: "skill_view",
      label: "Skill view",
      status: "completed",
      durationMs: 65,
      preview: "ventneuf-knowledge",
    },
    {
      id: "start-2",
      tool: "tool_describe",
      label: "Tool describe",
      status: "failed",
      durationMs: 40,
      preview: undefined,
    },
  ]);
});

test("keeps an unmatched tool start visible as running", () => {
  assert.equal(
    missionActivities([event("start", "tool.started", "terminal")])[0]?.status,
    "running",
  );
});
