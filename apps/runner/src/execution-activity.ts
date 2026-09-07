import type { AgentExecutionItem, AgentExecutionSnapshot } from "@ventneuf/domain";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeReviewState } from "./review-supervisor.js";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value)
  ? value as RecordValue : {};
const string = (value: unknown) => typeof value === "string" ? value : "";

export interface ScrubbedText {
  text: string;
  redacted: boolean;
}

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Keep user-visible agent details useful while removing credentials and private paths.
 * The returned flag lets approval callers avoid treating redacted text as complete.
 */
export function scrubSensitiveText(value: string, privatePaths: readonly string[] = []): ScrubbedText {
  let text = value;
  let redacted = false;
  for (const path of [...privatePaths].sort((left, right) => right.length - left.length)) {
    if (!path) continue;
    const next = text.replace(new RegExp(escaped(path), "g"), "[private path]");
    if (next !== text) redacted = true;
    text = next;
  }
  text = text.replace(/\b(Bearer\s+)[\w.+/=-]+/gi, (_match, prefix: string) => {
    redacted = true;
    return `${prefix}[redacted]`;
  });
  text = text.replace(/(https?:\/\/[^/\s:@]+:)[^@\s]+@/gi, (_match, prefix: string) => {
    redacted = true;
    return `${prefix}[redacted]@`;
  });
  text = text.replace(
    /((?:^|[\s"';&|])(?:--?)(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)(?:=|\s+))(["'])(.*?)\2/gi,
    (_match, prefix: string, quote: string) => {
      redacted = true;
      return `${prefix}${quote}[redacted]${quote}`;
    },
  );
  text = text.replace(
    /((?:^|[\s"';&|])(?:--?)(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)(?:=|\s+))([^\s"';&|]+)/gi,
    (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[redacted]`;
    },
  );
  text = text.replace(
    /((?:^|[\s"';&|])(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)\s*[:=]\s*)(["'])(.*?)\2/gi,
    (_match, prefix: string, quote: string) => {
      redacted = true;
      return `${prefix}${quote}[redacted]${quote}`;
    },
  );
  text = text.replace(
    /((?:^|[\s"';&|])(?:api[_-]?key|access[_-]?token|auth(?:orization)?|password|passwd|private[_-]?key|secret|token)\s*[:=]\s*)([^\s"',};&|]+)/gi,
    (_match, prefix: string) => {
      redacted = true;
      return `${prefix}[redacted]`;
    },
  );
  return { text, redacted };
}

function content(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(content).filter(Boolean).join("\n");
  return string(record(value).text);
}

/** Only displayable fields are projected; provider configuration and auth events are excluded. */
export class ExecutionActivity {
  private readonly items = new Map<string, AgentExecutionItem>();
  private revision = 0;
  private omittedItems = 0;
  private updatedAt = new Date().toISOString();
  private readonly messages = new Map<string, string>();

  constructor(readonly provider: "codex" | "claude", private rootThreadId: string, private readonly worktree: string) {}

  restore(snapshot: AgentExecutionSnapshot) {
    if (snapshot.version !== 1 || snapshot.provider !== this.provider) return;
    this.revision = snapshot.revision;
    this.omittedItems = snapshot.omittedItems;
    this.rootThreadId = snapshot.rootThreadId;
    this.updatedAt = snapshot.updatedAt;
    for (const item of snapshot.items) this.items.set(item.id, item);
  }

  setRootThread(threadId: string) { this.rootThreadId = threadId.slice(0, 200); }

  private display(value: string) {
    return scrubSensitiveText(value, [this.worktree, homedir()]).text
      .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
      .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
  }

  private put(item: AgentExecutionItem, append = false) {
    const previous = this.items.get(item.id);
    const text = this.display(append ? (previous?.text ?? "") + item.text : item.text);
    this.items.set(item.id, { ...item, id: item.id.slice(0, 400), threadId: item.threadId.slice(0, 200),
      label: this.display(item.label).slice(0, 200), text: text.slice(-4_000),
      ...((text.length > 4_000 || (append && previous?.truncated)) ? { truncated: true } : {}),
    });
    this.revision += 1;
    this.updatedAt = new Date().toISOString();
  }

  codex(value: unknown) {
    const event = record(value);
    const method = string(event.method);
    const params = record(event.params);
    const threadId = string(params.threadId) || this.rootThreadId;
    const parentId = threadId !== this.rootThreadId ? `agent:${threadId}` : undefined;
    const item = record(params.item);
    const nativeId = string(item.id) || string(params.itemId);
    const id = `${threadId}:${nativeId}`;
    const type = string(item.type);
    if (["item/agentMessage/delta", "item/commandExecution/outputDelta"].includes(method) && nativeId) {
      const previous = this.items.get(id);
      this.put({ id, threadId, parentId, kind: method.includes("agentMessage") ? "message" : "tool",
        label: previous?.label ?? (method.includes("agentMessage") ? "Message" : "Command"),
        status: "running", text: string(params.delta),
      }, true);
    } else if (["item/started", "item/completed"].includes(method) && nativeId && type !== "reasoning") {
      const status = item.status === "failed" || item.status === "declined" || record(item.error).message
        ? "failed" : method === "item/completed" ? "completed" : "running";
      let text = string(item.text) || string(item.command) || string(item.prompt) || string(item.query);
      if (type === "commandExecution") text = [string(item.command), string(item.aggregatedOutput)].filter(Boolean).join("\n\n");
      if (type === "fileChange") text = Array.isArray(item.changes)
        ? item.changes.map((change) => `${string(record(change).path)}\n${string(record(change).diff)}`).join("\n") : "";
      if (type === "mcpToolCall") text = content(record(item.result).content) || string(record(item.error).message);
      const label = type === "commandExecution" ? string(item.command).split("\n")[0] || "Command"
        : type === "mcpToolCall" ? `${string(item.server)} · ${string(item.tool)}` : type;
      this.put({ id, threadId, parentId, kind: type === "agentMessage" ? "message"
        : type === "fileChange" ? "diff" : type === "plan" ? "plan" : "tool",
        label, status, text: text || this.items.get(id)?.text || "" });
      if (type === "collabToolCall" || type.startsWith("collabAgent")) {
        const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds
          : [item.receiverThreadId ?? item.newThreadId];
        for (const receiver of receivers) {
          if (typeof receiver !== "string" || !receiver) continue;
          const previous = this.items.get(`agent:${receiver}`);
          const agentStatus = record(record(item.agentsStates)[receiver]).status
            ?? record(item.agentStatus).status ?? item.agentStatus;
          this.put({ id: `agent:${receiver}`, threadId: receiver, parentId,
            kind: "agent", label: string(item.tool) || "Subagent",
            status: agentStatus === "completed" ? "completed" : ["errored", "failed", "shutdown"].includes(string(agentStatus)) ? "failed"
              : previous?.status ?? "running", text: string(item.prompt) || previous?.text || "" });
        }
      }
    } else if (method === "turn/plan/updated") {
      const plan = Array.isArray(params.plan) ? params.plan : [];
      this.put({ id: `${threadId}:plan:${string(params.turnId)}`, threadId, parentId, kind: "plan", label: "Plan",
        status: plan.length && plan.every((step) => record(step).status === "completed") ? "completed" : "running",
        text: plan.map((step) => `${string(record(step).status)} · ${string(record(step).step)}`).join("\n") });
    } else if (method === "turn/diff/updated") {
      this.put({ id: `${threadId}:diff:${string(params.turnId)}`, threadId, parentId, kind: "diff", label: "Turn changes",
        status: "unknown", text: string(params.diff) });
    } else if (method === "turn/completed" && parentId) {
      const previous = this.items.get(parentId);
      this.put({ id: parentId, threadId, kind: "agent", label: previous?.label ?? "Subagent",
        parentId: previous?.parentId, text: previous?.text ?? "",
        status: record(params.turn).status === "completed" ? "completed" : "failed" });
    }
  }

  claude(value: unknown) {
    const event = record(value);
    const nativeParent = string(event.parent_tool_use_id);
    const threadId = nativeParent || this.rootThreadId;
    const parentId = nativeParent ? `tool:${nativeParent}` : undefined;
    const message = record(event.message);
    if (event.type === "stream_event") {
      const stream = record(event.event);
      if (stream.type === "message_start") {
        this.messages.set(threadId, string(record(stream.message).id));
      } else if (stream.type === "content_block_delta" && record(stream.delta).type === "text_delta") {
        const messageId = this.messages.get(threadId);
        if (messageId) this.put({ id: `${threadId}:${messageId}:${String(stream.index)}`, threadId, parentId,
          kind: "message", label: "Message", status: "running", text: string(record(stream.delta).text) }, true);
      }
      return;
    }
    if (Array.isArray(message.content)) message.content.forEach((raw, index) => {
      const block = record(raw);
      if (block.type === "text" && event.type === "assistant") {
        const messageId = string(message.id) || string(event.uuid);
        if (messageId) this.put({ id: `${threadId}:${messageId}:${index}`, threadId, parentId,
          kind: "message", label: "Message", status: "completed", text: string(block.text) });
      } else if (block.type === "tool_use" && typeof block.id === "string") {
        const input = record(block.input);
        const name = string(block.name);
        this.put({ id: `tool:${block.id}`, threadId, parentId, kind: ["Agent", "Task"].includes(name) ? "agent" : "tool",
          label: string(input.description) || name, status: "running",
          text: string(input.command) || string(input.file_path) || string(input.query)
            || string(input.skill) || string(input.prompt) });
      } else if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const id = `tool:${block.tool_use_id}`;
        const previous = this.items.get(id);
        this.put({ id, threadId: previous?.threadId ?? threadId, parentId: previous?.parentId ?? parentId,
          kind: previous?.kind ?? "tool", label: previous?.label ?? "Tool result",
          status: block.is_error === true ? "failed"
            : ["async_launched", "remote_launched", "sub_agent_entered"].includes(string(record(event.tool_use_result).status))
              ? "running" : "completed",
          text: [previous?.text, content(block.content)].filter(Boolean).join("\n\n") });
      }
    });
    if (event.type === "system" && ["task_started", "task_progress", "task_notification"].includes(string(event.subtype))) {
      const taskId = string(event.tool_use_id) || string(event.task_id);
      const id = string(event.tool_use_id) ? `tool:${taskId}` : `task:${taskId}`;
      const previous = this.items.get(id);
      if (taskId) this.put({ id, threadId: previous?.threadId ?? threadId, parentId: previous?.parentId ?? parentId,
        kind: previous?.kind ?? (event.task_type === "local_bash" ? "tool" : "agent"),
        label: previous?.label || string(event.description) || "Background task",
        status: event.subtype !== "task_notification" ? "running" : event.status === "completed" ? "completed" : "failed",
        text: string(event.summary) || string(event.description) || previous?.text || "" });
    }
    if (event.type === "system" && string(event.subtype).startsWith("hook_")) {
      const id = string(event.hook_id);
      if (id) this.put({ id: `hook:${id}`, threadId, parentId, kind: "status",
        label: string(event.hook_name) || "Hook", status: event.subtype === "hook_started" ? "running"
          : event.outcome === "error" ? "failed" : "completed", text: string(event.output) });
    }
  }

  snapshot(): AgentExecutionSnapshot {
    const snapshot: AgentExecutionSnapshot = { version: 1, provider: this.provider, rootThreadId: this.rootThreadId,
      revision: this.revision, updatedAt: this.updatedAt, omittedItems: this.omittedItems, items: [...this.items.values()] };
    while (snapshot.items.length > 80 || Buffer.byteLength(JSON.stringify(snapshot)) > 48_000) {
      const removed = snapshot.items.shift();
      if (!removed) break;
      this.items.delete(removed.id);
      snapshot.omittedItems = ++this.omittedItems;
    }
    return snapshot;
  }
}

/** Atomic, coalesced snapshots let the bridge reconnect without replaying provider deltas. */
export async function executionRecorder(directory: string, activity: ExecutionActivity) {
  const path = join(directory, "execution.json");
  try { activity.restore(JSON.parse(await readFile(path, "utf8")) as AgentExecutionSnapshot); }
  catch { /* A new mission has no previous snapshot. */ }
  let written = activity.snapshot().revision;
  let writing = Promise.resolve();
  const flush = () => {
    writing = writing.catch(() => undefined).then(async () => {
      const snapshot = activity.snapshot();
      if (snapshot.revision <= written) return;
      await writeReviewState(path, snapshot);
      written = snapshot.revision;
    });
    return writing;
  };
  const timer = setInterval(() => { void flush().catch(() => undefined); }, 500);
  timer.unref();
  return { flush, close: async () => { clearInterval(timer); await flush().catch(() => undefined); } };
}

export function publishExecution(directory: string, send?: (snapshot: AgentExecutionSnapshot) => Promise<void>) {
  let revision = 0;
  let inFlight: Promise<void> | undefined;
  const flush = async (): Promise<void> => {
    await inFlight;
    if (!send) return;
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const path = join(directory, "execution.json");
      if ((await stat(path)).size > 48_000) return;
      const snapshot = JSON.parse(await readFile(path, "utf8")) as AgentExecutionSnapshot;
      if (snapshot.revision <= revision) return;
      await send(snapshot);
      revision = snapshot.revision;
    })().catch(() => { /* Retry the latest snapshot; telemetry must not interrupt native execution. */ })
      .finally(() => { inFlight = undefined; });
    return inFlight;
  };
  const timer = setInterval(() => { if (!inFlight) void flush(); }, 1_000);
  timer.unref();
  return { flush, close: async () => { clearInterval(timer); await inFlight; } };
}
