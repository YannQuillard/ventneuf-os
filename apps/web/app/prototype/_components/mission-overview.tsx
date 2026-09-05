"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { PROTOTYPE_NOW } from "../../../lib/prototype/fixtures";
import { elapsedBetween, formatCost, formatCount, formatElapsed, formatTokens } from "../../../lib/prototype/format";
import { agentPresentation, approvalStatePresentation } from "../../../lib/prototype/presentation";
import { approvalsForMission, isTerminal, memberById } from "../../../lib/prototype/state";
import type { Approval, Device, Mission } from "../../../lib/prototype/types";
import { usePrototype } from "./prototype-provider";

interface MissionOverviewProps {
  mission: Mission;
  device?: Device;
}

const metadataLabel = { position: "start", width: 112 } as const;

function OutcomeBanner({ mission, pending }: { mission: Mission; pending: Approval[] }) {
  if (mission.status === "failed" && mission.failure) {
    return (
      <Banner status="error" title={mission.failure.reason} description={mission.failure.detail} collapsible={false}>
        <Text type="supporting">
          {"Worktree and terminal are retained for diagnosis until "}
          <Timestamp value={mission.failure.retainedUntil} format="date_time" />
          {"."}
        </Text>
      </Banner>
    );
  }
  if (mission.status === "cancelled" && mission.cancellation) {
    return (
      <Banner
        status="info"
        title="Mission cancelled"
        description={mission.cancellation.reason}
        collapsible={false}
      >
        <Text type="supporting">Owned processes were closed and the clean worktree was removed automatically.</Text>
      </Banner>
    );
  }
  if (mission.status === "completed") {
    return <Banner status="success" title="Mission completed" description={mission.summary} collapsible={false} />;
  }
  if (pending.length > 0) {
    return (
      <Banner
        status="warning"
        title={`${formatCount(pending.length, "approval")} waiting for your decision`}
        description="Decide in the conversation. The same agent session resumes with your answer."
        collapsible={false}
      />
    );
  }
  return null;
}

function ApprovalRow({ approval }: { approval: Approval }) {
  const presentation = approvalStatePresentation[approval.state];
  const decided = approval.decision
    ? `${approval.decision.outcome === "approved" ? "Approved" : "Rejected"} by ${approval.decision.by === "hermes" ? "Hermes" : approval.decision.authority.split(" · ")[0]}`
    : approval.state === "escalated" ? "Escalated to you by Hermes" : "Awaiting Hermes";
  return (
    <ListItem
      label={approval.operation}
      description={decided}
      startContent={<Token label={presentation.heading} color={presentation.tokenColor} size="sm" />}
      endContent={<Timestamp value={approval.decision?.at ?? approval.requestedAt} format="time" />}
    />
  );
}

export function MissionOverview({ mission, device }: MissionOverviewProps) {
  const { data } = usePrototype();
  const approvals = approvalsForMission(data, mission.id);
  const pending = isTerminal(mission.status) ? [] : approvals.filter((approval) => approval.state === "escalated");
  const initiator = memberById(data, mission.initiatedById);
  const elapsedMs = elapsedBetween(mission.startedAt, mission.endedAt ?? PROTOTYPE_NOW);
  const usedMinutes = Math.min(mission.authority.budgetMinutes, Math.round(elapsedMs / 60_000));

  return (
    <VStack gap={6} padding={4}>
      <OutcomeBanner mission={mission} pending={pending} />
      <VStack gap={2}>
        <Heading level={3}>Objective</Heading>
        <Text as="p">{mission.objective}</Text>
      </VStack>
      <MetadataList title={<Heading level={3}>Execution</Heading>} label={metadataLabel}>
        <MetadataListItem label="Repository">
          <Text type="code">{mission.repository}</Text>
        </MetadataListItem>
        <MetadataListItem label="Branch">
          {mission.branch ? (
            <>
              <Text type="code">{mission.branch}</Text>
              {" from "}
              <Text type="code">{mission.baseBranch}</Text>
            </>
          ) : `Read-only snapshot of ${mission.baseBranch}`}
        </MetadataListItem>
        {mission.worktree ? (
          <MetadataListItem label="Worktree">
            <Text type="code">{mission.worktree}</Text>
          </MetadataListItem>
        ) : null}
        <MetadataListItem label="Runner">
          <HStack gap={2} vAlign="center">
            <StatusDot variant={device?.isOnline ? "success" : "neutral"} label={device?.isOnline ? "Online" : "Offline"} />
            <Text>{device?.name ?? "Unknown device"}</Text>
            <Text type="supporting">{device?.platform}</Text>
          </HStack>
        </MetadataListItem>
        <MetadataListItem label="Agent">
          {`${agentPresentation[mission.agent].label} · `}
          <Text type="code">{mission.model}</Text>
        </MetadataListItem>
        <MetadataListItem label="Dispatched">
          {`${mission.dispatchedBy === "hermes" ? "By Hermes" : `By ${initiator?.name ?? "a member"}`} · `}
          <Timestamp value={mission.startedAt} format="date_time" />
        </MetadataListItem>
        <MetadataListItem label="Elapsed">{`${formatElapsed(elapsedMs)} · attempt ${mission.attempt}`}</MetadataListItem>
        <MetadataListItem label="Budget">{`${usedMinutes} of ${mission.authority.budgetMinutes} min used`}</MetadataListItem>
      </MetadataList>
      <MetadataList title={<Heading level={3}>Authority</Heading>} label={metadataLabel}>
        <MetadataListItem label="Delegated by">
          {`${initiator?.name ?? "The initiating member"} · expires `}
          <Timestamp value={mission.authority.expiresAt} format="time" />
        </MetadataListItem>
        <MetadataListItem label="Pre-authorised">{mission.authority.permitted.join(", ")}</MetadataListItem>
        <MetadataListItem label="Needs approval">
          {mission.authority.requiresApproval.length > 0
            ? mission.authority.requiresApproval.join(", ")
            : "Nothing beyond the pre-authorised scope"}
        </MetadataListItem>
        <MetadataListItem label="Never">{mission.authority.forbidden.join(", ")}</MetadataListItem>
      </MetadataList>
      {mission.usage ? (
        <MetadataList title={<Heading level={3}>Usage</Heading>} orientation="horizontal" label={{ position: "top" }}>
          <MetadataListItem label="Input tokens">{formatTokens(mission.usage.inputTokens)}</MetadataListItem>
          <MetadataListItem label="Output tokens">{formatTokens(mission.usage.outputTokens)}</MetadataListItem>
          <MetadataListItem label="Estimated cost">{formatCost(mission.usage.costUsd)}</MetadataListItem>
        </MetadataList>
      ) : null}
      <VStack gap={2}>
        <Heading level={3}>Approvals</Heading>
        {approvals.length > 0 ? (
          <List density="compact" hasDividers>
            {approvals.map((approval) => <ApprovalRow approval={approval} key={approval.id} />)}
          </List>
        ) : <Text type="supporting">No approval was needed. Every operation stayed within the pre-authorised scope.</Text>}
      </VStack>
    </VStack>
  );
}
