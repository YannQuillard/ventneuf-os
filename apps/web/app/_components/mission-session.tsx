"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Fragment, useState, type ReactNode } from "react";
import { actionTitle, countNodes, executionItemStatus, executionTree, hasFailure, interleaveApprovals, summarizeActions,
  type ExecutionNode, type TimelineEntry, type TimelineItem } from "../../lib/agent-execution";
import type { MissionApproval, MissionState } from "../../lib/conversations";
import styles from "./mission-session.module.css";
import type { MissionHistoryState } from "./use-mission-history";

type Node = ExecutionNode<TimelineItem>;
type Status = MissionState["status"];

function Occurred({ item }: { item: TimelineItem }) {
  return item.occurredAt ? <Timestamp value={item.occurredAt} format="time" /> : null;
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
  const status = executionItemStatus(item, missionStatus);
  const highlighted = item.status === "failed" || item.status === "running";
  const description = [steps ? `${steps} ${steps === 1 ? "step" : "steps"}` : undefined,
    item.status === "failed" && missionStatus !== "failed" ? "the mission continued" : undefined].filter(Boolean).join(" · ");
  return <ListItem label={actionTitle(item)}
    description={description || item.occurredAt ? <Text type="supporting">{description}{description && item.occurredAt ? " · " : ""}<Occurred item={item} /></Text> : undefined}
    startContent={highlighted ? <StatusDot variant={item.status === "failed" ? "error" : "accent"} label={status} isPulsing={item.status === "running"} /> : undefined}
    endContent={<Text type="supporting" hasTabularNumbers>{status}</Text>}
    onClick={onToggle ? () => onToggle(item.id) : undefined} isSelected={isSelected} />;
}

interface Segment { key: string; rows: Node[]; detail?: ReactNode }

/** Details render after their row rather than inside it, so the row itself stays one line. */
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

/** Failed and running steps stay visible; everything else folds into one summary line. */
function ActionGroup({ nodes, missionStatus }: { nodes: Node[]; missionStatus: Status }) {
  const [expandedId, setExpandedId] = useState<string>();
  const toggle = (id: string) => setExpandedId((current) => current === id ? undefined : id);
  const detail = (node: Node) => expandedId !== node.item.id ? null : <VStack gap={3}>
    {node.item.text || !node.children.length ? <Output item={node.item} /> : null}
    {node.children.length ? <NestedSteps nodes={node.children} missionStatus={missionStatus} /> : null}
  </VStack>;
  const highlights = nodes.filter((node) => hasFailure(node) || node.item.status === "running");
  const folded = nodes.filter((node) => !highlights.includes(node));
  return <div className={styles.group}>
    {highlights.length ? <Rows nodes={highlights} missionStatus={missionStatus} detail={detail} expandedId={expandedId} onToggle={toggle} /> : null}
    {folded.length ? <Collapsible defaultIsOpen={false} trigger={<Text type="supporting" color="secondary">{summarizeActions(folded.map((node) => node.item))}</Text>}>
      <Rows nodes={folded} missionStatus={missionStatus} detail={detail} expandedId={expandedId} onToggle={toggle} />
    </Collapsible> : null}
  </div>;
}

function MessageBlock({ item }: { item: TimelineItem }) {
  return <VStack gap={1}>
    <Markdown contentWidth={720} headingLevelStart={3} isStreaming={item.status === "running"}>{item.text}</Markdown>
    {item.occurredAt ? <Text type="supporting"><Occurred item={item} /></Text> : null}
  </VStack>;
}

interface Group { id: string; message?: Node; approval?: MissionApproval; actions: Node[] }

/** Consecutive actions form one group; messages and approvals break it so the narrative stays readable. */
function groupTimeline(entries: TimelineEntry[]): Group[] {
  return entries.reduce<Group[]>((groups, entry) => {
    if (entry.kind === "approval") return [...groups, { id: entry.approval.id, approval: entry.approval, actions: [] }];
    if (entry.node.item.kind === "message") return [...groups, { id: entry.node.item.id, message: entry.node, actions: [] }];
    const last = groups.at(-1);
    if (!last || last.message || last.approval) return [...groups, { id: entry.node.item.id, actions: [entry.node] }];
    return [...groups.slice(0, -1), { ...last, actions: [...last.actions, entry.node] }];
  }, []);
}

function HistoryNotice({ history }: { history: MissionHistoryState }) {
  if (history.status === "loading") return <HStack gap={2} vAlign="center"><Spinner size="sm" aria-label="Loading earlier activity" /><Text type="supporting">Loading earlier activity…</Text></HStack>;
  if (history.status === "error") return <HStack gap={2} vAlign="center" wrap="wrap">
    <Text type="supporting">Earlier activity could not be loaded.</Text>
    <Button label="Retry" size="sm" variant="ghost" onClick={history.retry} />
  </HStack>;
  if (history.status === "partial") return <Text type="supporting">Only the first part of the earlier activity is shown.</Text>;
  return null;
}

/** On a phone the timeline scrolls like a chat, so pending decisions sit at its end, where the agent is blocked. */
export function MissionSession({ items, approvals, renderApproval, missionStatus, history, trailing, footer }: {
  items: TimelineItem[]; approvals: MissionApproval[]; renderApproval(approval: MissionApproval): ReactNode;
  missionStatus: Status; history: MissionHistoryState; trailing?: ReactNode; footer?: ReactNode;
}) {
  const entries = interleaveApprovals(executionTree(items), approvals);
  const groups = groupTimeline(entries);
  return <VStack gap={5}>
    <HistoryNotice history={history} />
    {groups.map((group) => <Fragment key={group.id}>
      {group.approval ? renderApproval(group.approval) : null}
      {group.message ? <MessageBlock item={group.message.item} /> : null}
      {group.actions.length ? <ActionGroup nodes={group.actions} missionStatus={missionStatus} /> : null}
    </Fragment>)}
    {!entries.length && history.status !== "loading" ? <Text type="supporting" color="secondary">Waiting for readable agent activity.</Text> : null}
    {trailing}
    {footer}
  </VStack>;
}
