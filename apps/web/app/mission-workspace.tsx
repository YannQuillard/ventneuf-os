"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useEffect, useState } from "react";
import { MissionApprovalRequest } from "./_components/mission-approval";
import { MissionSession } from "./_components/mission-session";
import { MissionWorkspaceFrame } from "./_components/mission-workspace";
import { useMissionHistory } from "./_components/use-mission-history";
import { executionItemStatus, executionTree, mergeExecutionTimeline, type AgentExecution, type ExecutionNode } from "../lib/agent-execution";
import type { MissionApproval } from "../lib/conversations";
import { missionNow } from "../lib/mission-presentation";
import styles from "./mission-workspace.module.css";

const views = ["Session", "Changes", "Technical"] as const;

export function MissionWorkspace({ execution, conversationId, approvals = [], failure, onStop, isStopping, onClose, onDecided, onAskHermes, presentation }: {
  execution: AgentExecution; conversationId?: string; approvals?: MissionApproval[]; failure?: string;
  onStop(): void; isStopping: boolean; onClose(): void; onDecided(): Promise<void>; onAskHermes(approval: MissionApproval): void;
  presentation: "panel" | "sheet";
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
  const isStale = Boolean(execution.receivedAt && now - Date.parse(execution.receivedAt) > 30_000);
  const state = missionNow({ status: execution.status, approvals, current, isStale, result: execution.result, failure });
  const pending = approvals.filter((approval) => approval.status === "pending");
  const decided = approvals.filter((approval) => approval.status !== "pending");
  const provider = execution.provider === "claude" ? "Claude Code" : "Codex";
  const pullRequest = execution.result?.match(/https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/)?.[0];
  const rows = (nodes: ExecutionNode[]): TreeListItemData[] => nodes.map(({ item, children }) => ({
    id: item.id, label: <span className={styles.label}>{item.label || item.kind}</span>,
    endContent: <Text type="supporting" color="secondary">{executionItemStatus(item, execution.status)}</Text>,
    description: item.kind, isSelected: selectedId === item.id, isExpanded: true, onClick: () => setSelectedId(item.id),
    ...(children.length ? { children: rows(children) } : {}),
  }));
  const approvalRequest = (approval: MissionApproval) => <MissionApprovalRequest key={approval.id} approval={approval}
    onDecided={onDecided} onAskHermes={() => onAskHermes(approval)} isDetailOpen={presentation === "panel"} />;

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

  return <MissionWorkspaceFrame title={execution.title}
    subtitle={[provider, execution.model, execution.repositoryId, execution.missionId.slice(0, 8)].filter(Boolean).join(" · ")}
    status={<HStack gap={2} vAlign="center">
      <StatusDot variant={state.dot} label={state.label} isPulsing={state.isPulsing} />
      <Text type="supporting" color="primary" weight="medium">{state.label}</Text>
      {state.detail ? <Text type="supporting" maxLines={1}>{`· ${state.detail}`}</Text> : null}
    </HStack>}
    notice={presentation === "panel" && pending.length ? pending.map(approvalRequest) : undefined}
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
      {view === "Session" ? <MissionSession items={timeline} approvals={decided} renderApproval={approvalRequest}
        missionStatus={execution.status} provider={provider} history={history} footer={updated}
        trailing={presentation === "sheet" && pending.length ? pending.map(approvalRequest) : undefined} />
        : <>{view === "Changes" ? changeView : technical}{updated}</>}
    </VStack>
  </MissionWorkspaceFrame>;
}
