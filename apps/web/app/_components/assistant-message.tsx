"use client";

import { ChatMessage, ChatMessageBubble } from "@astryxdesign/core/Chat";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

export function AssistantMessage({ children, metadata, footer }: {
  children: ReactNode; metadata?: ReactNode; footer?: ReactNode;
}) {
  return <ChatMessage sender="assistant">
    <ChatMessageBubble
      variant="ghost"
      width="100%"
      name={<Text type="supporting" weight="semibold">Hermes</Text>}
      metadata={metadata}
    >
      {children}
    </ChatMessageBubble>
    {footer}
  </ChatMessage>;
}
