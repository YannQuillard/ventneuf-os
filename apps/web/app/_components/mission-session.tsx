"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Markdown } from "@astryxdesign/core/Markdown";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Fragment, useState, type ReactNode } from "react";
import { countNodes, executionItemStatus, executionTree, hasFailure, type ExecutionNode, type TimelineItem } from "../../lib/agent-execution";
import type { MissionState } from "../../lib/conversations";
import styles from "./mission-session.module.css";
import type { MissionHistoryState } from "./use-mission-history";

type Node = ExecutionNode<TimelineItem>;
type Filter = "all" | "issues";
type Status = MissionState["status"];

const kindLabel: Record<TimelineItem["kind"], string> = {
  message: "Message", tool: "Tool", agent: "Subagent", plan: "Plan", diff: "Changes", status: "Hook",
};

function dotVariant(status: TimelineItem["status"]) {
  if (status === "failed") return "error";
  if (status === "running") return "accent";
  return status === "unknown" ? "neutral" : "success";
}

function Occurred({ item }: { item: TimelineItem }) {
  return item.occurredAt ? <>{" · "}<Timestamp value={item.occurredAt} format="time" /></> : null;
}

function Output({ item }: { item: TimelineItem }) {
  return <VStack gap={2}>
    {item.kind === "agent" ? <Text type="supporting" color="primary">{item.text || "No brief recorded."}</Text>
      : <CodeBlock code={item.text || "No output recorded."} language={item.kind === "diff" ? "diff" : "plaintext"}
        size="sm" width="100%" isWrapped container="section" hasLanguageLabel={false} hasCopyButton={false} />}
    {item.truncated ? <Text type="supporting">Output was cut at the saved limit.</Text> : null}
  </VStack>;
}

function Row({ node, missionStatus, onToggle, isSelected }: { node: Node; missionStatus: Status; onToggle?(id: string): void; isSelected?: boolean }) {
  const { item } = node;
  const steps = countNodes(node);
  const note = item.status === "failed" && missionStatus !== "failed" ? "Attempt failed · mission continued" : undefined;
  const summary = [kindLabel[item.kind], steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : undefined, note].filter(Boolean).join(" · ");
  const status = executionItemStatus(item, missionStatus);
  return <ListItem label={item.label || kindLabel[item.kind]}
    description={<Text type="supporting">{summary}<Occurred item={item} /></Text>}
    startContent={<StatusDot variant={dotVariant(item.status)} label={status} isPulsing={item.status === "running"} />}
    endContent={<Text type="supporting" hasTabularNumbers>{status}</Text>}
    onClick={onToggle ? () => onToggle(item.id) : undefined} isSelected={isSelected} />;
}

interface Segment { key: string; rows: Node[]; detail?: ReactNode }

/** Details render after their row rather than inside it, so the status dot and status text stay on the row's line. */
function Rows({ nodes, missionStatus, detail, expandedId, onToggle }: {
  nodes: Node[]; missionStatus: Status; detail(node: Node): ReactNode; expandedId?: string; onToggle?(id: string): void;
}) {
  const segments = nodes.reduce<Segment[]>((acc, node) => {
    const last = acc.at(-1);
    const open = last && !last.detail ? { ...last, rows: [...last.rows, node] } : { key: node.item.id, rows: [node] };
    const block = detail(node);
    const segment = block ? { ...open, detail: block } : open;
    return last && !last.detail ? [...acc.slice(0, -1), segment] : [...acc, segment];
  }, []);
  return <VStack gap={0}>
    {segments.map((segment) => <Fragment key={segment.key}>
      <List density="compact" hasDividers>
        {segment.rows.map((node) => <Row key={node.item.id} node={node} missionStatus={missionStatus} onToggle={onToggle} isSelected={expandedId === node.item.id} />)}
      </List>
      {segment.detail ? <div className={styles.detail}>{segment.detail}</div> : null}
    </Fragment>)}
  </VStack>;
}

/** Subagent steps are read-only; failed steps show their output because they explain the parent outcome. */
function NestedSteps({ nodes, missionStatus }: { nodes: Node[]; missionStatus: Status }) {
  return <Rows nodes={nodes} missionStatus={missionStatus} detail={(node) => node.item.status === "failed" && node.item.text
    ? <VStack gap={2}><Output item={node.item} />{node.children.length ? <NestedSteps nodes={node.children} missionStatus={missionStatus} /> : null}</VStack>
    : node.children.length ? <NestedSteps nodes={node.children} missionStatus={missionStatus} /> : null} />;
}

function MessageBlock({ item, provider }: { item: TimelineItem; provider: string }) {
  return <VStack gap={1} paddingBlock={2}>
    <HStack gap={2} vAlign="center">
      {item.status === "running" ? <StatusDot variant="accent" label="Writing" isPulsing /> : null}
      <Text type="supporting">{provider}<Occurred item={item} /></Text>
    </HStack>
    <Markdown contentWidth={640} headingLevelStart={3} isStreaming={item.status === "running"}>{item.text}</Markdown>
  </VStack>;
}

interface Group { id: string; message?: Node; actions: Node[] }

/** Consecutive actions form one dense list; each agent message breaks the list so the narrative stays readable. */
function groupTimeline(nodes: Node[]): Group[] {
  return nodes.reduce<Group[]>((groups, node) => {
    if (node.item.kind === "message") return [...groups, { id: node.item.id, message: node, actions: [] }];
    const last = groups.at(-1);
    if (!last || last.message) return [...groups, { id: node.item.id, actions: [node] }];
    return [...groups.slice(0, -1), { ...last, actions: [...last.actions, node] }];
  }, []);
}

function HistoryNotice({ history }: { history: MissionHistoryState }) {
  if (history.status === "loading") return <HStack gap={2} vAlign="center"><Spinner size="sm" aria-label="Loading saved activity" /><Text type="supporting">Loading saved activity…</Text></HStack>;
  if (history.status === "error") return <HStack gap={2} vAlign="center" wrap="wrap">
    <Text type="supporting">Saved activity could not be loaded.</Text>
    <Button label="Retry" size="sm" variant="ghost" onClick={history.retry} />
  </HStack>;
  if (history.status === "partial") return <Text type="supporting">Only the first part of the saved activity is shown. Reopen the panel to continue loading.</Text>;
  return null;
}

export function MissionSession({ items, missionStatus, provider, history, footer }: {
  items: TimelineItem[]; missionStatus: Status; provider: string; history: MissionHistoryState; footer?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [expandedId, setExpandedId] = useState<string>();
  const toggle = (id: string) => setExpandedId((current) => current === id ? undefined : id);
  const roots = executionTree(items.filter((item) => item.kind !== "diff"));
  const issues = roots.filter((node) => node.item.kind !== "message" && hasFailure(node));
  const groups = groupTimeline(filter === "issues" ? issues : roots);
  const detail = (node: Node) => expandedId !== node.item.id ? null : <VStack gap={3}>
    {node.item.text || !node.children.length ? <Output item={node.item} /> : null}
    {node.children.length ? <NestedSteps nodes={node.children} missionStatus={missionStatus} /> : null}
  </VStack>;

  return <VStack gap={4}>
    <HistoryNotice history={history} />
    {roots.length ? <SegmentedControl value={filter} onChange={(value) => setFilter(value as Filter)} label="Filter the session" size="sm">
      <SegmentedControlItem value="all" label="All activity" />
      <SegmentedControlItem value="issues" label={issues.length ? `Issues · ${issues.length}` : "Issues"} />
    </SegmentedControl> : null}
    {groups.map((group) => <Fragment key={group.id}>
      {group.message ? <MessageBlock item={group.message.item} provider={provider} /> : null}
      {group.actions.length ? <Rows nodes={group.actions} missionStatus={missionStatus} detail={detail} expandedId={expandedId} onToggle={toggle} /> : null}
    </Fragment>)}
    {!roots.length && history.status !== "loading" ? <Text type="supporting" color="secondary">Waiting for readable agent activity.</Text> : null}
    {roots.length && filter === "issues" && !issues.length ? <Text type="supporting" color="secondary">No failed step in this session.</Text> : null}
    {footer}
  </VStack>;
}
