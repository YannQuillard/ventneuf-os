"use client";

import { ChatMessage, ChatMessageBubble, ChatMessageMetadata, ChatSystemMessage } from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import {
  ArrowUturnLeftIcon,
  BookOpenIcon,
  ChatBubbleLeftEllipsisIcon,
  ComputerDesktopIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline";
import type { IconType } from "@astryxdesign/core/Icon";
import { formatElapsed, formatTokens } from "../../../lib/prototype/format";
import type { Member, MessageTiming } from "../../../lib/prototype/types";

const systemIcons: Record<"thread" | "mission" | "knowledge" | "device", IconType> = {
  thread: ChatBubbleLeftEllipsisIcon,
  mission: RocketLaunchIcon,
  knowledge: BookOpenIcon,
  device: ComputerDesktopIcon,
};

interface HermesMessageProps {
  content: string;
  createdAt: string;
  timing?: MessageTiming;
  onQuote: (content: string) => void;
}

export function HermesMessage({ content, createdAt, timing, onQuote }: HermesMessageProps) {
  const duration = formatElapsed(timing?.totalMs);
  const details = [duration, timing?.tokens ? `${formatTokens(timing.tokens)} tokens` : undefined]
    .filter(Boolean)
    .join(" · ");

  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble variant="ghost" width="100%" name="Hermes">
        <Markdown contentWidth={760} headingLevelStart={3}>{content}</Markdown>
      </ChatMessageBubble>
      <ChatMessageMetadata
        timestamp={<Timestamp value={createdAt} format="time" />}
        footer={(
          <HStack gap={1} vAlign="center">
            {details ? <Text type="supporting">{details}</Text> : null}
            <IconButton
              label="Copy message"
              tooltip="Copy"
              variant="ghost"
              size="sm"
              icon={<Icon icon="copy" size="sm" />}
              onClick={() => void navigator.clipboard.writeText(content)}
            />
            <IconButton
              label="Quote this reply in the composer"
              tooltip="Quote"
              variant="ghost"
              size="sm"
              icon={<Icon icon={ArrowUturnLeftIcon} size="sm" />}
              onClick={() => onQuote(content)}
            />
          </HStack>
        )}
      />
    </ChatMessage>
  );
}

interface MemberMessageProps {
  author?: Member;
  isCurrentUser: boolean;
  content: string;
  createdAt: string;
}

export function MemberMessage({ author, isCurrentUser, content, createdAt }: MemberMessageProps) {
  if (isCurrentUser) {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble metadata={<ChatMessageMetadata timestamp={<Timestamp value={createdAt} format="time" />} />}>
          {content}
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble
        name={author?.name}
        metadata={<ChatMessageMetadata timestamp={<Timestamp value={createdAt} format="time" />} />}
      >
        {content}
      </ChatMessageBubble>
    </ChatMessage>
  );
}

interface SystemNoteProps {
  icon: keyof typeof systemIcons;
  content: string;
  createdAt: string;
}

export function SystemNote({ icon, content, createdAt }: SystemNoteProps) {
  return (
    <ChatSystemMessage icon={<Icon icon={systemIcons[icon]} size="sm" />}>
      {content}
      {" · "}
      <Timestamp value={createdAt} format="time" />
    </ChatSystemMessage>
  );
}

interface MilestoneNoteProps {
  title: string;
  description: string;
  href?: string;
  createdAt: string;
}

export function MilestoneNote({ title, description, href, createdAt }: MilestoneNoteProps) {
  return (
    <ChatSystemMessage icon={<Icon icon="check" size="sm" />}>
      {href ? <Link href={href} isExternalLink>{title}</Link> : title}
      {` · ${description} · `}
      <Timestamp value={createdAt} format="time" />
    </ChatSystemMessage>
  );
}
