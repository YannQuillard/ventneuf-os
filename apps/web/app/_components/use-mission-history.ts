"use client";

import { useEffect, useRef, useState } from "react";
import type { MissionHistoryEntry } from "@ventneuf/domain";

const pagesPerLoad = 60;

interface HistoryPage { items: Array<{ cursor: number; entry: MissionHistoryEntry }>; nextCursor: number; hasMore: boolean }

export interface MissionHistoryState {
  entries: MissionHistoryEntry[];
  status: "loading" | "ready" | "partial" | "error";
  retry(): void;
}

/** Saved activity is read forward from the first record so the timeline starts at the beginning of the mission. */
export function useMissionHistory(conversationId: string | undefined, missionId: string, isActive: boolean): MissionHistoryState {
  const [entries, setEntries] = useState<MissionHistoryEntry[]>([]);
  const [status, setStatus] = useState<MissionHistoryState["status"]>(conversationId ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  const cursor = useRef(0);

  useEffect(() => {
    if (!conversationId) return;
    let stopped = false;
    let timer: number | undefined;
    const load = async () => {
      try {
        let pages = 0;
        let hasMore = true;
        while (hasMore && pages < pagesPerLoad && !stopped) {
          const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(conversationId)}/missions/${encodeURIComponent(missionId)}/history?after=${cursor.current}`, { cache: "no-store" });
          if (!response.ok) throw new Error("History unavailable.");
          const page = await response.json() as HistoryPage;
          if (stopped) return;
          if (page.items.length) setEntries((previous) => [...previous, ...page.items.map((row) => row.entry)]);
          cursor.current = page.nextCursor;
          hasMore = page.hasMore;
          pages += 1;
        }
        setStatus(hasMore ? "partial" : "ready");
      } catch {
        if (!stopped) setStatus("error");
      }
      if (!stopped) timer = window.setTimeout(load, isActive ? 5_000 : 30_000);
    };
    void load();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [conversationId, missionId, isActive, attempt]);

  return { entries, status, retry: () => { setStatus("loading"); setAttempt((count) => count + 1); } };
}
