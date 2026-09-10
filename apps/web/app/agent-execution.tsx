"use client";

import { MissionHistory } from "./_components/mission-history";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Markdown } from "@astryxdesign/core/Markdown";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useEffect, useState } from "react";
import { MissionWorkspaceFrame } from "./_components/mission-workspace";
import { MissionStatusLabel } from "./_components/mission-status";
import { executionItemStatus, executionTree, type AgentExecution, type ExecutionNode } from "../lib/agent-execution";
import styles from "./agent-execution.module.css";

const views = ["Overview", "Session", "Changes", "History", "Technical"] as const;

export function AgentExecutionPanel({ execution, conversationId, onStop, isStopping, onClose, presentation }: {
  conversationId?: string; execution: AgentExecution; onStop(): void; isStopping: boolean; onClose(): void; presentation: "panel" | "sheet";
}) {
  const [view, setView] = useState<typeof views[number]>("Session");
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const snapshot = execution.snapshot;
  const items = snapshot?.items ?? [];
  const messages = items.filter((item) => item.kind === "message" && item.text);
  const actions = items.filter((item) => ["tool", "agent", "plan"].includes(item.kind));
  const changes = items.filter((item) => item.kind === "diff");
  const selected = items.find((item) => item.id === selectedId);
  const current = [...actions].reverse().find((item) => item.status === "running");
  const failedAttempts = actions.filter((item) => item.status === "failed");
  const active = ["queued", "running", "waiting_for_approval"].includes(execution.status);
  const stale = execution.status === "running" && execution.receivedAt && now - Date.parse(execution.receivedAt) > 30_000;
  const provider = execution.provider === "claude" ? "Claude Code" : "Codex";
  const pullRequest = execution.result?.match(/https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/)?.[0];
  const statusVariant = (status: string) => status === "failed" ? "error" as const : status === "running" ? "accent" as const : "success" as const;
  const rows = (nodes: ExecutionNode[]): TreeListItemData[] => nodes.map(({ item, children }) => ({
    id: item.id, label: <span className={styles.label}>{item.label || item.kind}</span>,
    endContent: <Text type="supporting" color="secondary">{executionItemStatus(item, execution.status)}</Text>,
    description: item.kind, isSelected: selectedId === item.id, isExpanded: true, onClick: () => setSelectedId(item.id),
    ...(children.length ? { children: rows(children) } : {}),
  }));

  const overview = <VStack gap={4}>
    <VStack gap={2}><Text type="label" weight="semibold">Original request</Text><Text>{execution.title}</Text></VStack>
    {execution.status === "waiting_for_approval" ? <Banner status="warning" title="Waiting for an approval decision"
      description="The request in the conversation shows whether Hermes is reviewing it or your decision is required." /> : null}
    {current ? <VStack gap={2}><Text type="label" weight="semibold">Current action</Text>
      <HStack gap={2} vAlign="center"><StatusDot variant="accent" label="Running" isPulsing /><Text>{current.label}</Text></HStack>
      {current.text ? <Text type="supporting" color="secondary">{current.text.split("\n")[0]}</Text> : null}</VStack> : null}
    {failedAttempts.length ? <Banner status={execution.status === "failed" ? "error" : "warning"}
      title={execution.status === "failed" ? "Mission stopped after a failed attempt" : `${failedAttempts.length} failed ${failedAttempts.length === 1 ? "attempt" : "attempts"}; the mission continued`}
      description={failedAttempts.at(-1)?.label} /> : null}
    {execution.result ? <VStack gap={2}><Text type="label" weight="semibold">Result</Text><Text>{execution.result}</Text></VStack> : null}
  </VStack>;

  const session = <VStack gap={4}>
    {messages.map((message) => <VStack gap={1} key={message.id}>
      <HStack gap={2} vAlign="center"><StatusDot variant={statusVariant(message.status)} label={executionItemStatus(message, execution.status)} />
        <Text type="supporting" color="secondary">{provider}</Text></HStack>
      <Markdown contentWidth={640} headingLevelStart={3} isStreaming={message.status === "running"}>{message.text}</Markdown>
    </VStack>)}
    {actions.length ? <VStack gap={2}><Text type="label" weight="semibold">Actions</Text><List hasDividers density="compact">
      {actions.map((item) => <ListItem key={item.id} label={item.label || item.kind}
        description={item.status === "failed" && execution.status !== "failed" ? "Attempt failed; mission continued" : executionItemStatus(item, execution.status)}
        endContent={<StatusDot variant={statusVariant(item.status)} label={executionItemStatus(item, execution.status)} />}
        isSelected={selectedId === item.id} onClick={() => setSelectedId((currentId) => currentId === item.id ? undefined : item.id)} />)}
    </List></VStack> : null}
    {selected && ["tool", "agent", "plan"].includes(selected.kind) && selected.text ? <CodeBlock title={selected.label}
      code={selected.text} language="plaintext" size="sm" width="100%" isWrapped hasLanguageLabel={false} /> : null}
    {!messages.length && !actions.length ? <Text type="supporting" color="secondary">Waiting for readable agent activity.</Text> : null}
  </VStack>;

  const changeView = <VStack gap={3}>{changes.length ? changes.map((item) => <CodeBlock key={item.id} title={item.label || "Changes"}
    code={item.text || "No diff content reported."} language="diff" size="sm" width="100%" isWrapped />)
    : <Text type="supporting" color="secondary">No changes have been reported.</Text>}</VStack>;

  const technical = <VStack gap={3}>
    <Text type="supporting" color="secondary">Raw native activity is available here for diagnosis. The Session view is the primary reading flow.</Text>
    {items.length ? <div className={styles.tree}><TreeList density="compact" items={rows(executionTree(items))} /></div>
      : <Text type="supporting" color="secondary">No protocol activity reported.</Text>}
    {selected ? <CodeBlock title={selected.label} code={selected.text || "No additional output reported."}
      language={selected.kind === "diff" ? "diff" : "plaintext"} size="sm" width="100%" isWrapped hasLanguageLabel={false} /> : null}
  </VStack>;

  return <MissionWorkspaceFrame title={`${provider} session`}
    subtitle={[execution.repositoryId, execution.model, execution.missionId.slice(0, 8)].filter(Boolean).join(" · ")}
    status={<MissionStatusLabel status={execution.status} detail={stale ? "No recent activity" : undefined} />}
    presentation={presentation} onClose={onClose} tab={view}
    onTabChange={(value) => { setView(value as typeof view); setSelectedId(undefined); }}
    tabs={views.filter(name => name !== "History" || conversationId).map((name) => ({ id: name, label: name,
      endContent: name === "Session" && items.length ? <Text type="supporting">{items.length}</Text> : undefined,
    }))}
    actions={<>
      {active && execution.canManage !== false ? <Button label="Stop mission" variant="secondary" size="sm" clickAction={onStop} isLoading={isStopping} /> : null}
      {pullRequest ? <Button label="Pull request" variant="secondary" size="sm" href={pullRequest} target="_blank" /> : null}
    </>}>
    <VStack gap={3} padding={4}>
      {view === "Overview" ? overview : view === "Session" ? session : view === "Changes" ? changeView : view === "History" && conversationId ? <MissionHistory key={execution.missionId} conversationId={conversationId} missionId={execution.missionId} /> : technical}
      {snapshot ? <Text type="supporting" color="secondary">{snapshot.omittedItems ? `${snapshot.omittedItems} earlier entries are outside this recent view. ` : ""}
        {`Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}.`}</Text> : null}
    </VStack>
  </MissionWorkspaceFrame>;
}
