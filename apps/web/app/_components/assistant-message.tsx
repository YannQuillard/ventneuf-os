"use client";

import { ChatMessage, ChatMessageBubble } from "@astryxdesign/core/Chat";
import type { ReactNode } from "react";

export function AssistantMessage({ children, metadata, footer }: {
  children: ReactNode; metadata?: ReactNode; footer?: ReactNode;
}) {
  return <ChatMessage sender="assistant">
    <ChatMessageBubble variant="ghost" width="100%" name="Hermes">{children}</ChatMessageBubble>
    {metadata}
    {footer}
  </ChatMessage>;
}
