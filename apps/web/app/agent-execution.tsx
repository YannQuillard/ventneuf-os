"use client";

import { Button } from "@astryxdesign/core/Button";
import { VStack } from "@astryxdesign/core/Layout";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { MissionWorkspaceFrame } from "./_components/mission-workspace";
import { MissionStatusLabel } from "./_components/mission-status";
import { Text } from "@astryxdesign/core/Text";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { useEffect, useState } from "react";
import { executionItemStatus, executionTree, type AgentExecution, type ExecutionNode } from "../lib/agent-execution";
import styles from "./agent-execution.module.css";

const views = ["Overview", "Activity", "Agents", "Changes"] as const;

export function AgentExecutionPanel({ execution, onStop, isStopping, onClose, presentation }: {
  execution: AgentExecution; onStop(): void; isStopping: boolean; onClose(): void; presentation: "panel" | "sheet";
}) {
  const [view, setView] = useState<typeof views[number]>("Activity");
  const [selectedId, setSelectedId] = useState<string>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(timer);
  }, []);
  const snapshot = execution.snapshot;
  const items = snapshot?.items ?? [];
  const selected = items.find((item) => item.id === selectedId);
  const filtered = items.filter((item) => view === "Activity" || (view === "Agents" ? item.kind === "agent" : item.kind === "diff"));
  const rows = (nodes: ExecutionNode[]): TreeListItemData[] => nodes.map(({ item, children }) => ({
    id: item.id, label: <span className={styles.label}>{item.label || item.kind}</span>,
    endContent: <Text type="supporting" color="secondary">{executionItemStatus(item, execution.status)}</Text>,
    description: item.kind === "agent" ? "Subagent" : undefined,
    isSelected: selectedId === item.id, isExpanded: true, onClick: () => setSelectedId(item.id),
    ...(children.length ? { children: rows(children) } : {}),
  }));
  const active = ["queued", "running", "waiting_for_approval"].includes(execution.status);
  const stale = execution.status === "running" && execution.receivedAt
    && now - Date.parse(execution.receivedAt) > 30_000;
  const provider = execution.provider === "claude" ? "Claude Code" : "Codex";
  const pullRequest = execution.result?.match(/https:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/pull\/\d+/)?.[0];

  return (
    <MissionWorkspaceFrame
      title={execution.title}
      subtitle={[provider, execution.model, execution.repositoryId, execution.missionId.slice(0, 8)].filter(Boolean).join(" · ")}
      status={<MissionStatusLabel status={execution.status} detail={stale ? "No recent activity" : undefined} />}
      presentation={presentation} onClose={onClose} tab={view}
      onTabChange={(value) => { setView(value as typeof view); setSelectedId(undefined); }}
      tabs={views.map((name) => ({ id: name, label: name,
        endContent: name === "Activity" && items.length ? <Text type="supporting">{items.length}</Text> : undefined,
      }))}
      actions={<>
        {active ? <Button label="Stop mission" variant="secondary" size="sm" clickAction={onStop} isLoading={isStopping} /> : null}
        {pullRequest ? <Button label="Pull request" variant="secondary" size="sm" href={pullRequest} target="_blank" /> : null}
      </>}
    >
      <VStack gap={3} padding={4}>
        {view === "Overview" ? <VStack gap={3}>
          <Text type="label" weight="semibold">Objective</Text>
          <Text>{execution.title}</Text>
          {execution.result ? <><Text type="label" weight="semibold">Result</Text><Text>{execution.result}</Text></> : null}
          <Text type="supporting" color="secondary">{items.filter((item) => item.kind === "agent").length} subagents in the recent activity view.</Text>
        </VStack> : <>
          <div className={styles.tree}>
            {filtered.length ? <TreeList density="compact" items={rows(executionTree(filtered))} />
              : <Text type="supporting" color="secondary">{snapshot
                ? `No ${view.toLowerCase()} reported in this view.`
                : "Waiting for agent activity. Missions started with an older runner do not publish this view."}</Text>}
          </div>
          {selected ? <VStack gap={2}>
            <Text type="supporting" color="secondary">{executionItemStatus(selected, execution.status)}</Text>
            <CodeBlock title={selected.label} code={selected.text || "No additional output reported."}
              language={selected.kind === "diff" ? "diff" : "plaintext"} size="sm" width="100%" isWrapped hasLanguageLabel={false} />
            {selected.truncated ? <Text type="supporting" color="secondary">Showing the latest part of this output.</Text> : null}
          </VStack> : null}
        </>}
        {snapshot ? <Text type="supporting" color="secondary">
          {snapshot.omittedItems ? `${snapshot.omittedItems} earlier entries are outside this recent activity view. ` : ""}
          {`Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}. Select an entry to inspect its output.`}
        </Text> : null}
      </VStack>
    </MissionWorkspaceFrame>
  );
}
