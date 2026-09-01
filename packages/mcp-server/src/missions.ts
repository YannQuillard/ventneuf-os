import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AppConfig } from "./config.js";

export interface MissionEvent {
  at: string;
  status: string;
  summary: string;
}

export interface Mission {
  id: string;
  status: string;
  summary?: string;
  events: MissionEvent[];
  updatedAt: string;
}

type MissionStore = Record<string, Mission>;

async function load(file: string): Promise<MissionStore> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as MissionStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function save(file: string, store: MissionStore): Promise<void> {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporary, file);
}

export async function getMission(
  config: AppConfig,
  id: string,
): Promise<Mission | undefined> {
  return (await load(config.missionsFile))[id];
}

export async function reportMissionProgress(
  config: AppConfig,
  id: string,
  status: string,
  summary: string,
): Promise<Mission> {
  const store = await load(config.missionsFile);
  const at = new Date().toISOString();
  const mission: Mission = store[id] ?? {
    id,
    status,
    events: [],
    updatedAt: at,
  };
  mission.status = status;
  mission.summary = summary;
  mission.updatedAt = at;
  mission.events.push({ at, status, summary });
  store[id] = mission;
  await save(config.missionsFile, store);
  return mission;
}
