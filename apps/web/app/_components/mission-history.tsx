"use client";
import { useState } from "react";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import type { MissionHistoryEntry } from "@ventneuf/domain";

export function MissionHistory({ conversationId, missionId }: { conversationId: string; missionId: string }) {
  const [rows, setRows] = useState<Array<{ cursor: number; entry: MissionHistoryEntry }>>([]);
  const [cursor, setCursor] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  async function load() {
    setLoading(true); setError(undefined);
    try {
      const response = await fetch(`/api/workspace/conversations/${encodeURIComponent(conversationId)}/missions/${encodeURIComponent(missionId)}/history?after=${cursor}`);
      if (!response.ok) throw new Error("History could not be loaded. Retry when the service is available.");
      const page = await response.json() as { items: typeof rows; nextCursor: number; hasMore: boolean };
      setRows(previous => [...previous, ...page.items.filter(row => !previous.some(item => item.cursor === row.cursor))]);
      setCursor(page.nextCursor); setMore(page.hasMore); setLoaded(true);
    } catch (error) { setError(error instanceof Error ? error.message : "History unavailable."); }
    finally { setLoading(false); }
  }
  return <VStack gap={3}>
    <Text type="supporting">Saved activity, in upload order. Timestamps show when each event occurred. Older missions may have no saved history.</Text>
    {rows.map(({ cursor, entry }) => <details key={cursor}>
      <summary><Text>{entry.item.label || entry.item.kind}</Text>{" · "}<Text type="supporting">{entry.item.status} · {new Date(entry.occurredAt).toLocaleTimeString()}</Text></summary>
      <VStack gap={2} padding={3}><Text type="supporting">{entry.provider} · {entry.item.kind}{entry.item.parentId ? " · Subagent activity" : ""}</Text>
        <CodeBlock code={entry.item.text || "No output recorded."} language="plaintext" size="sm" isWrapped width="100%" />
        {entry.item.truncated ? <Text type="supporting">This event exceeded the saved text limit. Its content is incomplete.</Text> : null}</VStack>
    </details>)}
    {loaded && !rows.length ? <Text type="supporting">No durable activity has been uploaded for this mission yet. The recent snapshot may still be available in Session.</Text> : null}
    {error ? <Text role="alert">{error}</Text> : null}
    <Button label={!loaded ? "Load saved history" : more ? "Load more history" : "Check for new events"} size="sm" isLoading={loading} onClick={() => void load()} />
  </VStack>;
}
