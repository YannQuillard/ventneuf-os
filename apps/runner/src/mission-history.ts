import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { MissionHistoryEntry } from "@ventneuf/domain";
import { writeReviewState } from "./review-supervisor.js";

// Kept local because the installed runner has no workspace-package runtime dependencies.
export const historyTextLimit = 32_000;
function isMissionHistoryBatch(value: unknown): value is MissionHistoryEntry[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 50
    && Buffer.byteLength(JSON.stringify(value)) <= 90_000
    && value.every(entry => entry && typeof entry.id === "string" && /^[a-f0-9-]{36}$/i.test(entry.id)
      && ["codex", "claude"].includes(entry.provider) && typeof entry.sessionId === "string"
      && Number.isFinite(Date.parse(entry.occurredAt)) && entry.item && typeof entry.item.text === "string"
      && entry.item.text.length <= historyTextLimit);
}

/** Immutable local batches survive supervisor restarts and ambiguous upload responses. */
export function historySpool(directory: string) {
  const root = join(directory, "history-pending");
  let writing = Promise.resolve();
  let failure: unknown;
  let serial = 0;
  return {
    append(entry: MissionHistoryEntry) {
      const name = `${Date.now().toString().padStart(16, "0")}-${String(serial++).padStart(8, "0")}-${randomUUID()}.json`;
      writing = writing.then(async () => {
        await mkdir(root, { recursive: true, mode: 0o700 });
        await writeReviewState(join(root, name), [entry]);
      }).catch(async error => {
        failure = error;
        await writeReviewState(join(directory, "history-error.json"), { message: "A history event could not be saved.", at: new Date().toISOString() }).catch(() => undefined);
      });
    },
    async flush() {
      await writing;
      if (failure) throw new Error("Mission history could not be persisted locally.", { cause: failure });
    },
  };
}

export async function hasPendingHistory(directory: string) {
  if (await stat(join(directory, "history-error.json")).then(() => true, () => false)) return true;
  return (await readdir(join(directory, "history-pending")).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).length > 0;
}

export async function uploadHistory(directory: string, send: (entries: MissionHistoryEntry[]) => Promise<void>, maxBatches = 4) {
  const root = join(directory, "history-pending");
  const names = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  // Keep the number of network round trips bounded so telemetry does not starve lease work.
  let batch: MissionHistoryEntry[] = [];
  let paths: string[] = [];
  let sent = 0;
  async function flush() {
    if (!batch.length) return;
    await send(batch);
    await Promise.all(paths.map(path => rm(path)));
    batch = []; paths = []; sent++;
  }
  for (const name of names.filter(name => name.endsWith(".json")).sort().slice(0, maxBatches * 50)) {
    const path = join(root, name);
    if ((await stat(path)).size > 90_000) throw new Error("Invalid local history batch.");
    const entries: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isMissionHistoryBatch(entries)) throw new Error("Invalid local history batch.");
    if (batch.length && (batch.length + entries.length > 50 || Buffer.byteLength(JSON.stringify([...batch, ...entries])) > 90_000)) {
      await flush();
      if (sent >= maxBatches) return;
    }
    batch.push(...entries); paths.push(path);
  }
  await flush();
}
