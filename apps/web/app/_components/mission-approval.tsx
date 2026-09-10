"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useState } from "react";
import type { MissionApproval } from "../../lib/conversations";
import { approvalPresentation } from "../../lib/mission-presentation";

export function MissionApprovalRequest({ approval, onDecided, onAskHermes, isDetailOpen = true }: {
  approval: MissionApproval;
  onDecided: () => Promise<void>;
  onAskHermes: () => void;
  isDetailOpen?: boolean;
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
  const pending = approval.status === "pending";
  const presentation = approvalPresentation(approval);
  const command = typeof approval.evidence.command === "string" ? approval.evidence.command : undefined;
  const endContent = presentation.isActionable
    ? <HStack gap={2}><Button label="Reject" size="sm" variant="secondary" isLoading={isDeciding} clickAction={() => decide("rejected")} />
      <Button label="Approve" size="sm" variant="primary" isLoading={isDeciding} clickAction={() => decide("approved")} /></HStack>
    : presentation.isReviewing
      ? <HStack gap={2} vAlign="center"><Spinner size="sm" aria-label="Hermes is deciding" /><Text type="supporting">Hermes is deciding</Text></HStack>
      : undefined;
  return <Banner status={error ? "error" : presentation.status} container="card"
    title={approval.action.summary || "Authority request"}
    description={<>{presentation.heading}{" · "}<Timestamp value={approval.createdAt} format="time" />{" · "}{approval.action.expectedEffect}</>}
    endContent={endContent} collapsible={{ defaultIsOpen: isDetailOpen && presentation.isActionable }}>
    <VStack gap={3}>
      <Text>{approval.reason}</Text>
      {command ? <CodeBlock title="Proposed command" code={command} language="shell" size="sm" width="100%" isWrapped /> : null}
      <MetadataList label={{ position: "start", width: 112 }}>
        <MetadataListItem label="Target"><Text type="code">{approval.action.target}</Text></MetadataListItem>
        <MetadataListItem label="Route">{presentation.route}</MetadataListItem>
        {approval.rationale ? <MetadataListItem label="Decision">{approval.rationale}</MetadataListItem> : null}
        <MetadataListItem label={pending ? "Expires" : "Expired"}><Timestamp value={approval.expiresAt} format="date_time" /></MetadataListItem>
      </MetadataList>
      <Text type="supporting">{presentation.note}</Text>
      {pending ? <Button label="Ask Hermes for details" variant="ghost" size="sm" onClick={onAskHermes} /> : null}
      <details>
        <summary>Technical details</summary>
        <VStack gap={2}>
          <Text type="code">{`Category: ${approval.action.category}`}</Text>
          <Text type="code">{`Arguments digest: ${approval.action.argumentsDigest}`}</Text>
          {Object.keys(approval.evidence).length ? <Text type="code">{JSON.stringify(approval.evidence)}</Text> : null}
        </VStack>
      </details>
      {error ? <Text type="supporting" role="alert">{error}</Text> : null}
    </VStack>
  </Banner>;
}
