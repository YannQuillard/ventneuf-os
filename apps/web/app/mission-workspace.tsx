"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useEffect, useState } from "react";
import { MissionApprovalRequest } from "./_components/mission-approval";
import { MissionSession } from "./_components/mission-session";
import { useMissionHistory } from "./_components/use-mission-history";
import { executionItemStatus, executionTree, mergeExecutionTimeline, type AgentExecution, type ExecutionNode } from "../lib/agent-execution";
import type { MissionApproval } from "../lib/conversations";
import { missionNow } from "../lib/mission-presentation";
import styles from "./mission-workspace.module.css";

export function MissionWorkspace({ execution, conversationId, approvals = [], failure, onStop, isStopping, onClose, onDecided, onAskHermes, presentation }: {
  execution: AgentExecution; conversationId?: string; approvals?: MissionApproval[]; failure?: string;
  onStop(): void; isStopping: boolean; onClose(): void; onDecided(): Promise<void>; onAskHermes(approval: MissionApproval): void;
  presentation: "panel" | "sheet";
}) {
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
  const current = [...timeline].reverse().find((item) => item.kind !== "message" && item.status === "running");
  const isStale = Boolean(execution.receivedAt && now - Date.parse(execution.receivedAt) > 30_000);
  const state = missionNow({ status: execution.status, approvals, current, isStale, result: execution.result, failure });
  const pending = approvals.filter((approval) => approval.status === "pending" && approval.route === "human");
  const inline = approvals.filter((approval) => !pending.includes(approval));
  const provider = execution.provider === "claude" ? "Claude Code" : "Codex";
  const pullRequest = execution.result?.match(/https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/)?.[0];
  const selected = items.find((item) => item.id === selectedId);
  const rows = (nodes: ExecutionNode[]): TreeListItemData[] => nodes.map(({ item, children }) => ({
    id: item.id, label: <span className={styles.label}>{item.label || item.kind}</span>,
    endContent: <Text type="supporting" color="secondary">{executionItemStatus(item, execution.status)}</Text>,
    description: item.kind, isSelected: selectedId === item.id, isExpanded: true, onClick: () => setSelectedId(item.id),
    ...(children.length ? { children: rows(children) } : {}),
  }));
  const approvalRequest = (approval: MissionApproval) => <MissionApprovalRequest key={approval.id} approval={approval}
    onDecided={onDecided} onAskHermes={() => onAskHermes(approval)} />;
  const decisions = pending.length ? <VStack gap={3}>{pending.map(approvalRequest)}</VStack> : null;

  const footer = <VStack gap={2}>
    {snapshot ? <Text type="supporting" color="secondary">{`Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}.`}</Text> : null}
    {items.length ? <Collapsible defaultIsOpen={false} trigger={<Text type="supporting">Raw activity</Text>}>
      <VStack gap={3} paddingBlockStart={2}>
        <div className={styles.tree}><TreeList density="compact" items={rows(executionTree(items))} /></div>
        {selected ? <CodeBlock title={selected.label} code={selected.text || "No additional output reported."}
          language={selected.kind === "diff" ? "diff" : "plaintext"} size="sm" width="100%" isWrapped hasLanguageLabel={false} /> : null}
      </VStack>
    </Collapsible> : null}
  </VStack>;

  return <section className={presentation === "panel" ? styles.panel : styles.sheet} aria-label="Mission">
    <div className={styles.header}>
      <HStack gap={2} vAlign="center">
        <StatusDot variant={state.dot} label={state.label} isPulsing={state.isPulsing} />
        <StackItem size="fill">
          <Text type="supporting" color="primary" maxLines={1}><Text type="supporting" color="primary" weight="medium">{state.label}</Text>{state.detail ? ` · ${state.detail}` : ""}</Text>
        </StackItem>
        {active && execution.canManage !== false ? <Button label="Stop" variant="ghost" size="sm" clickAction={onStop} isLoading={isStopping} /> : null}
        {pullRequest ? <Button label="Pull request" variant="ghost" size="sm" href={pullRequest} target="_blank" /> : null}
        {presentation === "panel" ? <IconButton label="Close the mission view" tooltip="Close" variant="ghost" size="sm"
          icon={<Icon icon="close" size="sm" />} onClick={onClose} /> : null}
      </HStack>
    </div>
    <VStack gap={1} paddingInline={4} paddingBlockEnd={4}>
      <Heading level={2} accessibilityLevel={2} maxLines={2}>{execution.title}</Heading>
      <Text type="supporting">{[provider, execution.model, execution.repositoryId].filter(Boolean).join(" · ")}</Text>
    </VStack>
    {presentation === "panel" && decisions ? <VStack paddingInline={4} paddingBlockEnd={4}>{decisions}</VStack> : null}
    <div className={styles.body}>
      <VStack gap={4} paddingInline={4} paddingBlockEnd={4}>
        <MissionSession items={timeline} approvals={inline} renderApproval={approvalRequest} missionStatus={execution.status}
          history={history} trailing={presentation === "sheet" ? decisions : undefined} footer={footer} />
      </VStack>
    </div>
  </section>;
}
