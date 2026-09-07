"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useState } from "react";
import type { MissionApproval } from "../../lib/conversations";

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
  const pending = approval.status === "pending";
  const actionable = pending && approval.canDecide === true;
  const command = typeof approval.evidence.command === "string" ? approval.evidence.command : undefined;
  return <Banner status={error ? "error" : pending ? "warning" : "info"} container="card"
    title={approval.action.summary || "Authority request"}
    description={`${approval.action.expectedEffect} · ${approval.status}`}
    endContent={actionable ? <HStack gap={2}><Button label="Reject" size="sm" variant="secondary" isLoading={isDeciding} clickAction={() => decide("rejected")} />
      <Button label="Approve" size="sm" variant="primary" isLoading={isDeciding} clickAction={() => decide("approved")} /></HStack> : undefined}
    collapsible={{ defaultIsOpen: pending }}>
    <VStack gap={3}>
      <Text>{approval.reason}</Text>
      {command ? <CodeBlock title="Proposed command" code={command} language="shell" size="sm" width="100%" isWrapped /> : null}
      <MetadataList label={{ position: "start", width: 112 }}>
        <MetadataListItem label="Target"><Text type="code">{approval.action.target}</Text></MetadataListItem>
        <MetadataListItem label="Effect">{approval.action.expectedEffect}</MetadataListItem>
        <MetadataListItem label="Expires"><Timestamp value={approval.expiresAt} format="date_time" /></MetadataListItem>
        {approval.rationale ? <MetadataListItem label="Decision">{approval.rationale}</MetadataListItem> : null}
      </MetadataList>
      {pending && !actionable ? <Text type="supporting">{approval.route === "hermes"
        ? "Hermes is reviewing this request against the mission authority."
        : "Only the mission initiator can decide this request. You can discuss it with Hermes here."}</Text> : null}
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
