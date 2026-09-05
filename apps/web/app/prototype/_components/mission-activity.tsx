"use client";

import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useState } from "react";
import { formatDiffStats, formatElapsed } from "../../../lib/prototype/format";
import { stepKindLabel, stepStatusPresentation } from "../../../lib/prototype/presentation";
import type { Mission, MissionStep } from "../../../lib/prototype/types";

type ActivityFilter = "all" | "edits" | "commands" | "approvals";

const filters: Record<ActivityFilter, (step: MissionStep) => boolean> = {
  all: () => true,
  edits: (step) => step.kind === "edit" || step.kind === "git",
  commands: (step) => step.kind === "command" || step.kind === "test" || step.kind === "browser",
  approvals: (step) => step.kind === "approval" || step.kind === "hermes",
};

function stepDescription(step: MissionStep): string {
  return [
    stepKindLabel[step.kind],
    step.detail,
    step.additions !== undefined && step.deletions !== undefined ? formatDiffStats(step.additions, step.deletions) : undefined,
  ].filter(Boolean).join(" · ");
}

export function MissionActivity({ mission }: { mission: Mission }) {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [expandedId, setExpandedId] = useState<string>();
  const steps = mission.steps.filter(filters[filter]);

  return (
    <VStack gap={0}>
      <HStack padding={4} paddingBlockEnd={2}>
        <SegmentedControl value={filter} onChange={(value) => setFilter(value as ActivityFilter)} label="Filter activity" size="sm">
          <SegmentedControlItem value="all" label="All" />
          <SegmentedControlItem value="edits" label="Edits" />
          <SegmentedControlItem value="commands" label="Commands" />
          <SegmentedControlItem value="approvals" label="Approvals" />
        </SegmentedControl>
      </HStack>
      {steps.length === 0 ? (
        <EmptyState title="No matching activity" description="Try another filter." isCompact />
      ) : (
        <List density="compact" hasDividers>
          {steps.map((step) => {
            const presentation = stepStatusPresentation[step.status];
            const isExpanded = expandedId === step.id;
            return (
              <ListItem
                key={step.id}
                label={step.label}
                description={(
                  <VStack gap={2}>
                    <Text type="supporting">
                      {stepDescription(step)}
                      {" · "}
                      <Timestamp value={step.startedAt} format="time" />
                    </Text>
                    {isExpanded && step.output ? (
                      <CodeBlock
                        code={step.output}
                        language="plaintext"
                        size="sm"
                        container="section"
                        hasCopyButton={false}
                        isWrapped
                        width="100%"
                      />
                    ) : null}
                  </VStack>
                )}
                startContent={<StatusDot variant={presentation.dot} label={presentation.label} isPulsing={presentation.isPulsing} />}
                endContent={(
                  <Text type="supporting" hasTabularNumbers>
                    {step.status === "running" ? "Running" : step.status === "pending" ? "Pending" : formatElapsed(step.durationMs) ?? presentation.label}
                  </Text>
                )}
                onClick={step.output ? () => setExpandedId(isExpanded ? undefined : step.id) : undefined}
                isSelected={isExpanded}
              />
            );
          })}
        </List>
      )}
    </VStack>
  );
}
