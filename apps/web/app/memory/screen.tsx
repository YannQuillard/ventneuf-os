"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useState } from "react";
import { workspaceRequest, type MemoryEntry } from "../../lib/workspace";
import { PageHeader } from "../_components/page-header";
import { useWorkspaceNavigation } from "../workspace";

export function MemoryScreen() {
  const { isMobile, openNavigation, openNewConversation } = useWorkspaceNavigation();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    setLoading(true);
    try { const payload = await workspaceRequest<{ entries: MemoryEntry[] }>("/memory"); setEntries(payload.entries); setError(undefined); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load memory."); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => !normalized || `${entry.title} ${entry.summary ?? ""} ${entry.path ?? ""}`.toLocaleLowerCase().includes(normalized));

  return <Layout height="fill" header={<PageHeader title="Memory" subtitle="Your durable knowledge, managed with Hermes"
    icon={BookOpenIcon} onOpenNavigation={isMobile ? openNavigation : undefined}
    actions={<Button label="Ask Hermes" variant="secondary" size="sm" onClick={openNewConversation} />} />}
    content={<LayoutContent padding={4} label="Memory"><VStack gap={4}>
      {error ? <Banner status="error" title="Memory unavailable" description={error}
        endContent={<Button label="Retry" variant="secondary" size="sm" clickAction={refresh} />} /> : null}
      {!error ? <TextInput label="Search memory" value={query} onChange={setQuery} placeholder="Search titles, summaries, and paths" hasClear /> : null}
      {isLoading ? <Text type="supporting" role="status">Loading memory…</Text> : null}
      {!isLoading && !error && visible.length ? <List hasDividers density="compact">{visible.map((entry) => <ListItem
        key={entry.id} label={entry.title} description={entry.summary ?? entry.path}
        startContent={<Icon icon={BookOpenIcon} color="secondary" />}
        endContent={<Timestamp value={entry.updatedAt} format="auto" />} />)}</List> : null}
      {!isLoading && !error && !visible.length ? <EmptyState title={query ? "No matching memory" : "No memory entries yet"}
        description={query ? "Try a different search." : "Talk with Hermes to record, organize, or correct durable information."}
        actions={!query ? <Button label="Start a conversation" variant="primary" onClick={openNewConversation} /> : undefined} /> : null}
    </VStack></LayoutContent>} />;
}
