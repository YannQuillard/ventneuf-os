"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageMetadata,
  ChatSystemMessage,
} from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { formatDuration, type Message, type MissionTiming } from "../lib/conversations";

function timing(message: Message): MissionTiming | undefined {
  const value = message.metadata?.timing;
  return value && typeof value === "object" ? value as MissionTiming : undefined;
}

export function ConversationMessage({ message }: { message: Message }) {
  if (message.role === "system" || message.role === "tool") {
    return (
      <ChatSystemMessage icon={message.role === "tool" ? <Icon icon="wrench" size="sm" /> : undefined}>
        {message.content}
      </ChatSystemMessage>
    );
  }

  if (message.role === "user") {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble
          metadata={<ChatMessageMetadata timestamp={<Timestamp value={message.createdAt} format="time" />} />}
        >
          {message.content}
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return (
    <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />}>
      <ChatMessageBubble variant="ghost" width="100%">
        <Markdown contentWidth={840}>{message.content}</Markdown>
      </ChatMessageBubble>
      <ChatMessageMetadata
        timestamp={<Timestamp value={message.createdAt} format="time" />}
        footer={(
          <div className="message-actions">
            {formatDuration(timing(message)?.totalMs) ? (
              <span>{formatDuration(timing(message)?.totalMs)}</span>
            ) : null}
            <IconButton
              label="Copy message"
              tooltip="Copy"
              variant="ghost"
              size="sm"
              icon={<Icon icon="copy" size="sm" />}
              onClick={() => void navigator.clipboard.writeText(message.content)}
            />
          </div>
        )}
      />
    </ChatMessage>
  );
}
