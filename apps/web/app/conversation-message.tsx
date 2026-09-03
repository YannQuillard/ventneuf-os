"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import {
  ChatMessage,
  ChatMessageBubble,
  ChatMessageMetadata,
  ChatSystemMessage,
  type ChatMessageStatus,
} from "@astryxdesign/core/Chat";
import { useStreamingText } from "@astryxdesign/core/hooks";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { ArrowPathIcon, ArrowUturnLeftIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { useEffect } from "react";
import { formatDuration, type Message, type MissionTiming } from "../lib/conversations";

interface ConversationMessageProps {
  message: Message;
  status?: ChatMessageStatus;
  isRevealing?: boolean;
  onRevealed?: () => void;
  onQuote?: (content: string) => void;
  onEdit?: (content: string) => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  onInspect?: () => void;
}

function timing(message: Message): MissionTiming | undefined {
  const value = message.metadata?.timing;
  return value && typeof value === "object" ? value as MissionTiming : undefined;
}

function RevealingMarkdown({ content, onRevealed }: { content: string; onRevealed: () => void }) {
  const displayed = useStreamingText(content, true, { speed: "fast" });

  useEffect(() => {
    if (displayed === content) onRevealed();
  }, [content, displayed, onRevealed]);

  return <Markdown contentWidth={840} isStreaming>{displayed}</Markdown>;
}

function InspectAction({ onInspect }: { onInspect?: () => void }) {
  if (!onInspect) return null;

  return (
    <IconButton
      label="Inspect the details of this message"
      tooltip="Inspect details"
      variant="ghost"
      size="sm"
      icon={<Icon icon="info" size="sm" />}
      onClick={onInspect}
    />
  );
}

function UserMessageActions({
  content,
  hasFailed,
  onEdit,
  onRetry,
  onDismiss,
  onInspect,
}: {
  content: string;
  hasFailed: boolean;
  onEdit?: (content: string) => void;
  onRetry?: () => void;
  onDismiss?: () => void;
  onInspect?: () => void;
}) {
  if (hasFailed) {
    return (
      <div className="message-actions">
        <IconButton
          label="Send this message again"
          tooltip="Send again"
          variant="ghost"
          size="sm"
          icon={<Icon icon={ArrowPathIcon} size="sm" />}
          onClick={onRetry}
        />
        <IconButton
          label="Discard this message"
          tooltip="Discard"
          variant="ghost"
          size="sm"
          icon={<Icon icon="close" size="sm" />}
          onClick={onDismiss}
        />
        <InspectAction onInspect={onInspect} />
      </div>
    );
  }

  return (
    <div className="message-actions">
      {onEdit ? (
        <IconButton
          label="Edit this message and send it again"
          tooltip="Edit & resend"
          variant="ghost"
          size="sm"
          icon={<Icon icon={PencilSquareIcon} size="sm" />}
          onClick={() => onEdit(content)}
        />
      ) : null}
      <InspectAction onInspect={onInspect} />
    </div>
  );
}

export function ConversationMessage({
  message,
  status,
  isRevealing = false,
  onRevealed,
  onQuote,
  onEdit,
  onRetry,
  onDismiss,
  onInspect,
}: ConversationMessageProps) {
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
          metadata={(
            <ChatMessageMetadata
              timestamp={<Timestamp value={message.createdAt} format="time" />}
              status={status}
              footer={status === "sending" ? undefined : (
                <UserMessageActions
                  content={message.content}
                  hasFailed={status === "error"}
                  onEdit={onEdit}
                  onRetry={onRetry}
                  onDismiss={onDismiss}
                  onInspect={onInspect}
                />
              )}
            />
          )}
        >
          {message.content}
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  const duration = formatDuration(timing(message)?.totalMs);

  return (
    <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />}>
      <ChatMessageBubble variant="ghost" width="100%">
        {isRevealing && onRevealed ? (
          <RevealingMarkdown content={message.content} onRevealed={onRevealed} />
        ) : (
          <Markdown contentWidth={840}>{message.content}</Markdown>
        )}
      </ChatMessageBubble>
      <ChatMessageMetadata
        timestamp={<Timestamp value={message.createdAt} format="time" />}
        footer={(
          <div className="message-actions">
            {duration ? <span>{duration}</span> : null}
            <IconButton
              label="Copy message"
              tooltip="Copy"
              variant="ghost"
              size="sm"
              icon={<Icon icon="copy" size="sm" />}
              onClick={() => void navigator.clipboard.writeText(message.content)}
            />
            {onQuote ? (
              <IconButton
                label="Quote this reply in the composer"
                tooltip="Quote"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowUturnLeftIcon} size="sm" />}
                onClick={() => onQuote(message.content)}
              />
            ) : null}
            {onRetry ? (
              <IconButton
                label="Ask Hermes again"
                tooltip="Retry"
                variant="ghost"
                size="sm"
                icon={<Icon icon={ArrowPathIcon} size="sm" />}
                onClick={onRetry}
              />
            ) : null}
            <InspectAction onInspect={onInspect} />
          </div>
        )}
      />
    </ChatMessage>
  );
}
