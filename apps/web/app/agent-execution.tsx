"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useEffect, useState } from "react";
import { MissionSession } from "./_components/mission-session";
import { MissionWorkspaceFrame } from "./_components/mission-workspace";
import { MissionStatusLabel } from "./_components/mission-status";
import { useMissionHistory } from "./_components/use-mission-history";
import { executionItemStatus, executionTree, mergeExecutionTimeline, type AgentExecution, type ExecutionNode } from "../lib/agent-execution";
import type { MissionApproval } from "../lib/conversations";
import { pendingApprovalSummary } from "../lib/mission-presentation";
import styles from "./agent-execution.module.css";

const views = ["Overview", "Session", "Changes", "Technical"] as const;

function ApprovalBanner({ pending }: { pending: ReturnType<typeof pendingApprovalSummary> }) {
  if (pending === "your decision") return <Banner status="warning" title="A request needs your decision"
    description="Decide in the conversation. The same agent session resumes with your answer." />;
  if (pending === "initiator decision") return <Banner status="info" title="Waiting for the mission initiator"
    description="Only the mission initiator can decide the pending request." />;
  if (pending === "Hermes reviewing") return <Banner status="info" title="Hermes is reviewing a request"
    description="No action is needed from you. The agent resumes once Hermes decides." />;
  return <Banner status="warning" title="Waiting for an approval decision"
    description="The request in the conversation shows who decides." />;
}

export function AgentExecutionPanel({ execution, conversationId, approvals = [], onStop, isStopping, onClose, presentation }: {
  execution: AgentExecution; conversationId?: string; approvals?: MissionApproval[];
  onStop(): void; isStopping: boolean; onClose(): void; presentation: "panel" | "sheet";
}) {
  const [view, setView] = useState<typeof views[number]>("Session");
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const active = ["queued", "running", "waiting_for_approval"].includes(execution.status);
  const history = useMissionHistory(conversationId, execution.missionId, active);
  const snapshot = execution.snapshot;
  const items = snapshot?.items ?? [];
  const timeline = mergeExecutionTimeline(history.entries, snapshot);
  const actions = timeline.filter((item) => ["tool", "agent", "plan"].includes(item.kind));
  const changes = timeline.filter((item) => item.kind === "diff");
  const selected = items.find((item) => item.id === selectedId);
  const current = [...actions].reverse().find((item) => item.status === "running");
  const failedAttempts = actions.filter((item) => item.status === "failed");
  const stale = execution.status === "running" && execution.receivedAt && now - Date.parse(execution.receivedAt) > 30_000;
  const pending = pendingApprovalSummary(approvals);
  const provider = execution.provider === "claude" ? "Claude Code" : "Codex";
  const pullRequest = execution.result?.match(/https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/)?.[0];
  const rows = (nodes: ExecutionNode[]): TreeListItemData[] => nodes.map(({ item, children }) => ({
    id: item.id, label: <span className={styles.label}>{item.label || item.kind}</span>,
    endContent: <Text type="supporting" color="secondary">{executionItemStatus(item, execution.status)}</Text>,
    description: item.kind, isSelected: selectedId === item.id, isExpanded: true, onClick: () => setSelectedId(item.id),
    ...(children.length ? { children: rows(children) } : {}),
  }));

  const overview = <VStack gap={4}>
    <VStack gap={2}><Text type="label" weight="semibold">Original request</Text><Text>{execution.title}</Text></VStack>
    {execution.status === "waiting_for_approval" ? <ApprovalBanner pending={pending} /> : null}
    {current ? <VStack gap={2}><Text type="label" weight="semibold">Current action</Text>
      <HStack gap={2} vAlign="center"><StatusDot variant="accent" label="Running" isPulsing /><Text>{current.label}</Text></HStack>
      {current.text ? <Text type="supporting" color="secondary">{current.text.split("\n")[0]}</Text> : null}</VStack> : null}
    {failedAttempts.length ? <Banner status={execution.status === "failed" ? "error" : "warning"}
      title={execution.status === "failed" ? "Mission stopped after a failed attempt" : `${failedAttempts.length} failed ${failedAttempts.length === 1 ? "attempt" : "attempts"}; the mission continued`}
      description={failedAttempts.at(-1)?.label} /> : null}
    {execution.result ? <VStack gap={2}><Text type="label" weight="semibold">Result</Text><Text>{execution.result}</Text></VStack> : null}
  </VStack>;

  const changeView = <VStack gap={3}>{changes.length ? changes.map((item) => <CodeBlock key={item.id} title={item.label || "Changes"}
    code={item.text || "No diff content reported."} language="diff" size="sm" width="100%" isWrapped />)
    : <Text type="supporting" color="secondary">No changes have been reported.</Text>}</VStack>;

  const technical = <VStack gap={3}>
    <Text type="supporting" color="secondary">Raw native activity from the recent snapshot, for diagnosis. The Session view is the primary reading flow.</Text>
    {items.length ? <div className={styles.tree}><TreeList density="compact" items={rows(executionTree(items))} /></div>
      : <Text type="supporting" color="secondary">No protocol activity reported.</Text>}
    {selected ? <CodeBlock title={selected.label} code={selected.text || "No additional output reported."}
      language={selected.kind === "diff" ? "diff" : "plaintext"} size="sm" width="100%" isWrapped hasLanguageLabel={false} /> : null}
  </VStack>;

  const updated = snapshot ? <Text type="supporting" color="secondary">{`Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}.`}</Text> : null;

  return <MissionWorkspaceFrame title={`${provider} session`}
    subtitle={[execution.repositoryId, execution.model, execution.missionId.slice(0, 8)].filter(Boolean).join(" · ")}
    status={<MissionStatusLabel status={execution.status} detail={stale ? "No recent activity" : execution.status === "waiting_for_approval" ? pending : undefined} />}
    presentation={presentation} onClose={onClose} tab={view}
    onTabChange={(value) => { setView(value as typeof view); setSelectedId(undefined); }}
    tabs={views.map((name) => ({ id: name, label: name,
      endContent: name === "Session" && timeline.length ? <Text type="supporting">{timeline.length}</Text> : undefined,
    }))}
    actions={<>
      {active && execution.canManage !== false ? <Button label="Stop mission" variant="secondary" size="sm" clickAction={onStop} isLoading={isStopping} /> : null}
      {pullRequest ? <Button label="Pull request" variant="secondary" size="sm" href={pullRequest} target="_blank" /> : null}
    </>}>
    <VStack gap={3} padding={4}>
      {view === "Session" ? <MissionSession items={timeline} missionStatus={execution.status} provider={provider} history={history} footer={updated} />
        : <>{view === "Overview" ? overview : view === "Changes" ? changeView : technical}{updated}</>}
    </VStack>
  </MissionWorkspaceFrame>;
}
