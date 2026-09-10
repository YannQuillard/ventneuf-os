"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { Collapsible } from "@astryxdesign/core/Collapsible";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useState, type ReactNode } from "react";
import type { MissionApproval } from "../../lib/conversations";
import { approvalPresentation } from "../../lib/mission-presentation";

function Details({ approval, onAskHermes, isPending, trigger }: { approval: MissionApproval; onAskHermes: () => void; isPending: boolean; trigger: ReactNode }) {
  const command = typeof approval.evidence.command === "string" ? approval.evidence.command : undefined;
  return <Collapsible defaultIsOpen={false} trigger={trigger}>
    <VStack gap={3} paddingBlockStart={2}>
      <Text>{approval.reason}</Text>
      {command ? <CodeBlock code={command} language="shell" size="sm" width="100%" isWrapped hasLanguageLabel={false} /> : null}
      <MetadataList label={{ position: "start", width: 96 }}>
        <MetadataListItem label="Target"><Text type="code">{approval.action.target}</Text></MetadataListItem>
        <MetadataListItem label="Route">{approvalPresentation(approval).route}</MetadataListItem>
        {approval.rationale ? <MetadataListItem label="Decision">{approval.rationale}</MetadataListItem> : null}
        <MetadataListItem label={isPending ? "Expires" : "Expired"}><Timestamp value={approval.expiresAt} format="date_time" /></MetadataListItem>
        <MetadataListItem label="Digest"><Text type="code">{approval.action.argumentsDigest}</Text></MetadataListItem>
      </MetadataList>
      {isPending ? <HStack><Button label="Ask Hermes about this request" variant="ghost" size="sm" onClick={onAskHermes} /></HStack> : null}
    </VStack>
  </Collapsible>;
}

/** Hermes review and recorded decisions are one line each; only a decision that waits for a member gets a card. */
export function MissionApprovalRequest({ approval, onDecided, onAskHermes }: {
  approval: MissionApproval;
  onDecided: () => Promise<void>;
  onAskHermes: () => void;
}) {
  const [isDeciding, setDeciding] = useState(false);
  const [error, setError] = useState<string>();
  const decide = async (decision: "approved" | "rejected") => {
    setDeciding(true); setError(undefined);
    try {
      const response = await fetch(`/api/hermes/approvals/${encodeURIComponent(approval.id)}/decision`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ requestId: crypto.randomUUID(), decision,
          rationale: decision === "approved" ? "Approved after review in the mission thread." : "Rejected after review in the mission thread." }),
      });
      if (!response.ok) throw new Error("Hermes could not apply this decision.");
      await onDecided();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to decide this request."); }
    finally { setDeciding(false); }
  };
  const presentation = approvalPresentation(approval);
  const isPending = approval.status === "pending";
  const summary = approval.action.summary || "Authority request";
  const details = (trigger: ReactNode) => <Details approval={approval} onAskHermes={onAskHermes} isPending={isPending} trigger={trigger} />;
  const line = (marker: ReactNode, heading: string) => <HStack gap={2} vAlign="start">
    {marker}
    <Text>{`${heading} · ${summary} `}<Timestamp value={approval.createdAt} format="time" /></Text>
  </HStack>;

  if (presentation.isReviewing) return details(line(<Spinner size="sm" aria-label="Hermes is reviewing" />, "Hermes is reviewing"));

  if (!isPending) return details(line(<StatusDot label={presentation.heading}
    variant={approval.status === "approved" ? "success" : approval.status === "rejected" ? "error" : "neutral"} />, presentation.heading));

  return <Banner status={error ? "error" : "warning"} container="card" collapsible={false} title={summary}
    description={`${presentation.heading} · ${approval.action.expectedEffect}`}>
    <VStack gap={3}>
      {presentation.isActionable ? <HStack gap={2}>
        <Button label="Approve" size="sm" variant="primary" isLoading={isDeciding} clickAction={() => decide("approved")} />
        <Button label="Reject" size="sm" variant="secondary" isLoading={isDeciding} clickAction={() => decide("rejected")} />
      </HStack> : <Text type="supporting">{presentation.note}</Text>}
      {details(<Text type="supporting">Details</Text>)}
      {error ? <Text type="supporting" role="alert">{error}</Text> : null}
    </VStack>
  </Banner>;
}
