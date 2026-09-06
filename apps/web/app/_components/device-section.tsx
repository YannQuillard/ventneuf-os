"use client";

import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import type { ReactNode } from "react";

export function DeviceSection({ name, isOnline, detail, lastSeenAt, actions, children }: {
  name: string; isOnline: boolean; detail: string; lastSeenAt?: string; actions?: ReactNode; children: ReactNode;
}) {
  return <VStack gap={1}>
    <HStack gap={2} vAlign="center" paddingBlock={1} wrap="wrap">
      <StatusDot variant={isOnline ? "success" : "neutral"} label={isOnline ? "Online" : "Offline"} />
      <Text weight="semibold">{name}</Text>
      <StackItem size="fill"><Text type="supporting" maxLines={1}>{detail}</Text></StackItem>
      {lastSeenAt ? <Text type="supporting">{isOnline ? "Heartbeat " : "Last seen "}<Timestamp value={lastSeenAt} format="time" /></Text> : null}
      {actions}
    </HStack>
    {children}
  </VStack>;
}
