"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Selector } from "@astryxdesign/core/Selector";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { workspaceRequest, type MemoryEntry } from "../../lib/workspace";
import { PageHeader } from "../_components/page-header";
import { useWorkspaceNavigation } from "../workspace";

export function MemoryScreen() {
  const { isMobile, openNavigation, openNewConversation, snapshot } = useWorkspaceNavigation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<MemoryEntry>();
  const [scope, setScope] = useState(() => searchParams.get("conversationId") ?? "personal");
  const [query, setQuery] = useState("");
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const suffix = scope === "personal" ? "" : `?conversationId=${encodeURIComponent(scope)}`;
      const payload = await workspaceRequest<{ entries: MemoryEntry[] }>(`/memory${suffix}`);
      setEntries(payload.entries); setSelected(undefined); setError(undefined);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load memory."); }
    finally { setLoading(false); }
  }, [scope]);
  useEffect(() => { void refresh(); }, [refresh]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = entries.filter((entry) => !normalized || `${entry.title} ${entry.summary ?? ""} ${entry.path ?? ""}`.toLocaleLowerCase().includes(normalized));
  const scopeOptions = [
    { value: "personal", label: "Personal memory", description: "Private durable knowledge" },
    ...(snapshot?.conversations ?? []).map((conversation) => ({
      value: conversation.id,
      label: conversation.title || "Untitled conversation",
      description: conversation.kind === "mission" ? "Mission thread memory" : "Conversation memory",
    })),
  ];
  const openEntry = async (entry: MemoryEntry) => {
    setSelected(entry);
    try {
      const suffix = scope === "personal" ? "" : `?conversationId=${encodeURIComponent(scope)}`;
      const payload = await workspaceRequest<{ entry: MemoryEntry }>(`/memory/${encodeURIComponent(entry.id)}${suffix}`);
      setSelected(payload.entry);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open this memory entry."); }
  };

  return <Layout height="fill" header={<PageHeader title="Memory" subtitle="Your durable knowledge, managed with Hermes"
    icon={BookOpenIcon} onOpenNavigation={isMobile ? openNavigation : undefined}
    actions={<Button label="Ask Hermes" variant="secondary" size="sm" onClick={openNewConversation} />} />}
    content={<LayoutContent padding={4} label="Memory"><VStack gap={4}>
      {error ? <Banner status="error" title="Memory unavailable" description={error}
        endContent={<Button label="Retry" variant="secondary" size="sm" clickAction={refresh} />} /> : null}
      {!error ? <HStack gap={3} wrap="wrap">
        <Selector label="Memory scope" options={scopeOptions} value={scope} onChange={(value) => {
          setScope(value);
          router.replace(value === "personal" ? "/memory" : `/memory?conversationId=${encodeURIComponent(value)}`);
        }} hasSearch={scopeOptions.length > 8} width={280} />
        <StackItem size="fill"><TextInput label="Search memory" value={query} onChange={setQuery} placeholder="Search titles, summaries, and paths" hasClear width="100%" /></StackItem>
        <Button label="Refresh" variant="ghost" clickAction={refresh} />
      </HStack> : null}
      {isLoading ? <Text type="supporting" role="status">Loading memory…</Text> : null}
      {!isLoading && !error && visible.length ? <List hasDividers density="compact">{visible.map((entry) => <ListItem
        key={entry.id} label={entry.title} description={entry.summary ?? entry.path}
        startContent={<Icon icon={BookOpenIcon} color="secondary" />}
        endContent={<Timestamp value={entry.updatedAt} format="auto" />} isSelected={selected?.id === entry.id}
        onClick={() => void openEntry(entry)} />)}</List> : null}
      {selected ? <VStack gap={3} paddingBlock={3}>
        <Heading level={2}>{selected.title}</Heading>
        <MetadataList orientation="horizontal">
          {selected.path ? <MetadataListItem label="Path"><Text type="code">{selected.path}</Text></MetadataListItem> : null}
          <MetadataListItem label="Updated"><Timestamp value={selected.updatedAt} format="date_time" /></MetadataListItem>
        </MetadataList>
        {selected.content ? <Markdown contentWidth={760} headingLevelStart={3}>{selected.content}</Markdown>
          : <Text type="supporting">Select refresh if this entry's content has not loaded.</Text>}
      </VStack> : null}
      {!isLoading && !error && !visible.length ? <EmptyState title={query ? "No matching memory" : "No memory entries yet"}
        description={query ? "Try a different search." : "Talk with Hermes to record, organize, or correct durable information."}
        actions={!query ? <Button label="Start a conversation" variant="primary" onClick={openNewConversation} /> : undefined} /> : null}
    </VStack></LayoutContent>} />;
}
