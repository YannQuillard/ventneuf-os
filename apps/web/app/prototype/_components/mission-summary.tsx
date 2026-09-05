"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Text } from "@astryxdesign/core/Text";
import { PROTOTYPE_NOW } from "../../../lib/prototype/fixtures";
import { elapsedBetween, formatCount, formatElapsed } from "../../../lib/prototype/format";
import type { MissionTab } from "../../../lib/prototype/navigation";
import { agentPresentation } from "../../../lib/prototype/presentation";
import { isTerminal } from "../../../lib/prototype/state";
import type { Approval, Device, Mission } from "../../../lib/prototype/types";
import { MissionStatusLabel } from "./mission-status";

interface MissionSummaryProps {
  mission: Mission;
  approvals: Approval[];
  device?: Device;
  onOpen: (tab?: MissionTab) => void;
  onStop: () => void;
  onRetry: () => void;
  onRedirect: () => void;
}

function statusLine(mission: Mission): string {
  if (mission.status === "failed" && mission.failure) return `${mission.failure.reason}. ${mission.failure.detail}`;
  if (mission.status === "cancelled" && mission.cancellation) return mission.cancellation.reason;
  if (mission.currentStep) return mission.currentStep;
  return mission.summary;
}

export function MissionSummary({ mission, approvals, device, onOpen, onStop, onRetry, onRedirect }: MissionSummaryProps) {
  const isActive = !isTerminal(mission.status);
  const elapsedMs = elapsedBetween(mission.startedAt, mission.endedAt ?? PROTOTYPE_NOW);
  const pendingForMember = approvals.filter((approval) => approval.state === "escalated").length;
  const meta = [
    agentPresentation[mission.agent].label,
    mission.model,
    device?.name,
    mission.branch ?? mission.repository,
    `attempt ${mission.attempt}`,
    pendingForMember > 0 ? `${formatCount(pendingForMember, "approval")} waiting for you` : undefined,
    mission.pullRequest ? `PR #${mission.pullRequest.number}` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <Card padding={3} variant="muted">
      <VStack gap={2}>
        <HStack gap={3} vAlign="start">
          <StackItem size="fill">
            <VStack gap={1}>
              <MissionStatusLabel status={mission.status} detail={formatElapsed(elapsedMs)} />
              <Text weight="semibold">{mission.title}</Text>
              <Text type="supporting">{meta}</Text>
            </VStack>
          </StackItem>
          <Button
            label="Open"
            size="sm"
            variant="ghost"
            endContent={<Icon icon="chevronRight" size="sm" />}
            onClick={() => onOpen()}
          />
        </HStack>
        <Text type="supporting" color="primary">{statusLine(mission)}</Text>
        <HStack gap={1} vAlign="center" wrap="wrap">
          <Button label="Activity" size="sm" variant="ghost" onClick={() => onOpen("activity")} />
          {mission.files.length > 0 ? (
            <Button label={`Changes · ${mission.files.length}`} size="sm" variant="ghost" onClick={() => onOpen("changes")} />
          ) : null}
          <Button label="Terminal" size="sm" variant="ghost" onClick={() => onOpen("terminal")} />
          <StackItem size="fill" />
          {isActive ? (
            <>
              <Button label="Redirect" size="sm" variant="ghost" onClick={onRedirect} />
              <Button label="Stop" size="sm" variant="ghost" onClick={onStop} />
            </>
          ) : (
            <Button label="Retry" size="sm" variant="ghost" onClick={onRetry} />
          )}
          {mission.pullRequest ? (
            <Button label="Pull request" size="sm" variant="ghost" href={mission.pullRequest.url} target="_blank" />
          ) : null}
        </HStack>
      </VStack>
    </Card>
  );
}
