"use client";

import { Card } from "@astryxdesign/core/Card";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import type { CSSProperties } from "react";
import { formatDuration, type Message, type MissionTiming } from "../lib/conversations";

const senders: Record<Message["role"], string> = {
  assistant: "Hermes",
  user: "You",
  system: "System",
  tool: "Tool",
};

const labels = { position: "start", width: 104 } as const;

function timing(message: Message): MissionTiming | undefined {
  const value = message.metadata?.timing;
  return value && typeof value === "object" ? value as MissionTiming : undefined;
}

function panelWidth(size: number): CSSProperties {
  return { "--details-panel-width": `${size}px` } as CSSProperties;
}

export function MessageDetailsPanel({ message, onClose }: { message: Message; onClose: () => void }) {
  const panel = useResizable({
    defaultSize: 360,
    minSizePx: 300,
    maxSizePx: 480,
    autoSaveId: "conversation-details-panel",
  });
  const execution = timing(message);
  const queue = formatDuration(execution?.queueMs);
  const hermes = formatDuration(execution?.hermesMs);
  const total = formatDuration(execution?.totalMs);
  const hasExecution = Boolean(
    queue || hermes || total || execution?.acceptedAt || execution?.persistedAt,
  );

  return (
    <>
      <ResizeHandle
        direction="horizontal"
        resizable={panel.props}
        isReversed
        pillPlacement="start"
        hasDivider
        label="Resize the message details panel"
        className="details-panel-handle"
      />
      <Card
        variant="transparent"
        height="100%"
        padding={0}
        className="details-panel"
        style={panelWidth(panel.size)}
      >
        <Toolbar
          label="Message details"
          dividers={["bottom"]}
          startContent={<Text type="label" weight="semibold">Message details</Text>}
          endContent={(
            <IconButton
              label="Close the message details"
              tooltip="Close"
              variant="ghost"
              size="sm"
              icon={<Icon icon="close" size="sm" />}
              onClick={onClose}
            />
          )}
        />
        <VStack gap={5} padding={4} isScrollable className="details-panel-body">
          <MetadataList title="Message" label={labels}>
            <MetadataListItem label="Sender">{senders[message.role]}</MetadataListItem>
            <MetadataListItem label="Sent">
              <Timestamp value={message.createdAt} format="date_time" isTimezoneShown />
            </MetadataListItem>
            <MetadataListItem label="Identifier">
              <Text type="code">{message.id}</Text>
            </MetadataListItem>
            <MetadataListItem label="Length">
              {`${message.content.length} characters`}
            </MetadataListItem>
          </MetadataList>
          {hasExecution ? (
            <MetadataList title="Execution" label={labels}>
              {queue ? <MetadataListItem label="Queued for">{queue}</MetadataListItem> : null}
              {hermes ? <MetadataListItem label="Hermes time">{hermes}</MetadataListItem> : null}
              {total ? <MetadataListItem label="Total">{total}</MetadataListItem> : null}
              {execution?.acceptedAt ? (
                <MetadataListItem label="Accepted">
                  <Timestamp value={execution.acceptedAt} format="date_time" isTimezoneShown />
                </MetadataListItem>
              ) : null}
              {execution?.persistedAt ? (
                <MetadataListItem label="Persisted">
                  <Timestamp value={execution.persistedAt} format="date_time" isTimezoneShown />
                </MetadataListItem>
              ) : null}
            </MetadataList>
          ) : null}
        </VStack>
      </Card>
    </>
  );
}
