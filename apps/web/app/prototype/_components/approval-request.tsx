"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Token } from "@astryxdesign/core/Token";
import { approvalStatePresentation } from "../../../lib/prototype/presentation";
import { isPendingApproval, isTerminal } from "../../../lib/prototype/state";
import type { Approval, ApprovalCategory, Mission } from "../../../lib/prototype/types";

interface ApprovalRequestProps {
  approval: Approval;
  mission: Mission;
  onDecide: (outcome: "approved" | "rejected") => void;
  onOpenMission: () => void;
}

const categoryLabels: Record<ApprovalCategory, string> = {
  network: "Network access",
  dependency: "Dependency change",
  filesystem: "Filesystem outside the worktree",
  git: "Git operation",
  process: "Process or container",
  connector: "Connector access",
};

const metadataLabel = { position: "start", width: 112 } as const;

function agentLabel(mission: Mission): string {
  return mission.agent === "codex" ? "Codex" : "Claude";
}

function routeLabel(approval: Approval): string {
  if (approval.state === "requested") return "Hermes decides within its delegated authority";
  if (approval.state === "escalated") return "Escalated by Hermes to the initiating member";
  if (approval.decision?.by === "hermes") return "Decided by Hermes within its delegated authority";
  return "Routed to the initiating member by project policy";
}

function deciderLabel(approval: Approval): string {
  if (!approval.decision) return "";
  return approval.decision.by === "hermes" ? "Hermes" : approval.decision.authority.split(" · ")[0];
}

export function ApprovalRequest({ approval, mission, onDecide, onOpenMission }: ApprovalRequestProps) {
  const presentation = approvalStatePresentation[approval.state];
  const isPending = isPendingApproval(approval);
  const isActionable = approval.state === "escalated" && !isTerminal(mission.status);
  const isStale = isPending && isTerminal(mission.status);

  const endContent = isActionable ? (
    <HStack gap={2} vAlign="center">
      <Button label="Reject" size="sm" variant="secondary" onClick={() => onDecide("rejected")} />
      <Button label="Approve" size="sm" variant="primary" onClick={() => onDecide("approved")} />
    </HStack>
  ) : approval.state === "requested" && !isStale ? (
    <HStack gap={2} vAlign="center">
      <Spinner size="sm" aria-label="Hermes is deciding" />
      <Text type="supporting">Hermes is deciding</Text>
    </HStack>
  ) : approval.decision ? (
    <Token label={`${presentation.heading} by ${deciderLabel(approval)}`} color={presentation.tokenColor} size="sm" />
  ) : (
    <Token label="No longer actionable" color="gray" size="sm" />
  );

  return (
    <Banner
      status={isStale ? "info" : presentation.banner}
      container="card"
      title={approval.operation}
      description={(
        <>
          {isStale ? "Mission ended before a decision" : presentation.heading}
          {" · "}
          {agentLabel(mission)}
          {" at "}
          <Timestamp value={approval.requestedAt} format="time" />
          {" · "}
          {approval.expectedEffect}
        </>
      )}
      endContent={endContent}
      collapsible={{ defaultIsOpen: false }}
      className="prototype-approval"
    >
      <VStack gap={3}>
        <Text>{approval.reason}</Text>
        <MetadataList label={metadataLabel}>
          <MetadataListItem label="Target">
            <Text type="code">{approval.target}</Text>
          </MetadataListItem>
          <MetadataListItem label="Category">{categoryLabels[approval.category]}</MetadataListItem>
          <MetadataListItem label="Route">{routeLabel(approval)}</MetadataListItem>
          {approval.hermesNote ? <MetadataListItem label="Hermes">{approval.hermesNote}</MetadataListItem> : null}
          {approval.decision ? (
            <MetadataListItem label="Decision">
              {`${approval.decision.outcome === "approved" ? "Approved" : "Rejected"} by ${deciderLabel(approval)} · ${approval.decision.note}`}
              {" · "}
              <Timestamp value={approval.decision.at} format="time" />
            </MetadataListItem>
          ) : null}
          {approval.resumedAt ? (
            <MetadataListItem label="Resumed">
              <Text type="code">{approval.sessionRef}</Text>
              {" at "}
              <Timestamp value={approval.resumedAt} format="time" />
            </MetadataListItem>
          ) : null}
          <MetadataListItem label={isPending ? "Expires" : "Expired"}>
            <Timestamp value={approval.expiresAt} format="time" />
          </MetadataListItem>
          <MetadataListItem label="Digest">
            <Text type="code">{approval.digest}</Text>
          </MetadataListItem>
        </MetadataList>
        <HStack gap={2}>
          <Button label="Mission activity" size="sm" variant="ghost" onClick={onOpenMission} />
        </HStack>
      </VStack>
    </Banner>
  );
}
