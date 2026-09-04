import type { MissionEvent } from "./conversations";

export interface MissionActivity {
  id: string;
  tool: string;
  label: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  preview?: string;
}

function words(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
}

function sentence(value: string) {
  const normalized = words(value);
  return normalized ? `${normalized[0].toUpperCase()}${normalized.slice(1)}` : "Tool";
}

export function toolLabel(tool: string) {
  if (tool.startsWith("mcp__")) {
    const [, server = "mcp", operation = "tool"] = tool.split("__");
    return `${sentence(server)} · ${sentence(operation)}`;
  }
  return sentence(tool);
}

function eventTool(event: MissionEvent) {
  return typeof event.payload.tool === "string" ? event.payload.tool : undefined;
}

function eventPreview(event: MissionEvent) {
  return typeof event.payload.preview === "string" && event.payload.preview.trim()
    ? event.payload.preview.trim()
    : undefined;
}

export function missionActivities(events: MissionEvent[]): MissionActivity[] {
  const activities: MissionActivity[] = [];
  const runningByTool = new Map<string, number[]>();

  for (const event of events) {
    const tool = eventTool(event);
    if (!tool || (event.type !== "tool.started" && event.type !== "tool.completed")) continue;

    if (event.type === "tool.started") {
      const index = activities.push({
        id: event.id,
        tool,
        label: toolLabel(tool),
        status: "running",
        preview: eventPreview(event),
      }) - 1;
      runningByTool.set(tool, [...(runningByTool.get(tool) ?? []), index]);
      continue;
    }

    const pending = runningByTool.get(tool) ?? [];
    const index = pending.shift();
    runningByTool.set(tool, pending);
    const rawDuration = event.payload.duration;
    const durationMs = typeof rawDuration === "number" && Number.isFinite(rawDuration)
      ? Math.max(0, rawDuration * 1_000)
      : undefined;
    const failed = event.payload.error === true;

    if (index === undefined) {
      activities.push({
        id: event.id,
        tool,
        label: toolLabel(tool),
        status: failed ? "failed" : "completed",
        durationMs,
        preview: eventPreview(event),
      });
      continue;
    }

    activities[index] = {
      ...activities[index],
      status: failed ? "failed" : "completed",
      durationMs,
      preview: activities[index].preview ?? eventPreview(event),
    };
  }

  return activities;
}
