"use client";

import { Blockquote } from "@astryxdesign/core/Blockquote";
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
import { formatCount, formatElapsed, formatTokens } from "../../../lib/prototype/format";
import { conversationHref } from "../../../lib/prototype/navigation";
import type { Conversation, Member, MessageTiming } from "../../../lib/prototype/types";

const systemIcons: Record<"thread" | "mission" | "knowledge" | "device", IconType> = {
  thread: ChatBubbleLeftEllipsisIcon,
  mission: RocketLaunchIcon,
  knowledge: BookOpenIcon,
  device: ComputerDesktopIcon,
};

export interface ThreadReference {
  thread: Conversation;
  replyCount: number;
}

function ThreadLink({ reference }: { reference: ThreadReference }) {
  return (
    <HStack gap={1} vAlign="center">
      <Icon icon={ChatBubbleLeftEllipsisIcon} size="sm" color="secondary" />
      <Link href={conversationHref(reference.thread.id)} isStandalone>{reference.thread.title}</Link>
      <Text type="supporting">{`· ${formatCount(reference.replyCount, "reply", "replies")}`}</Text>
    </HStack>
  );
}

function StartThreadAction({ onStartThread }: { onStartThread?: () => void }) {
  if (!onStartThread) return null;
  return (
    <IconButton
      label="Start a thread from this message"
      tooltip="Start thread"
      variant="ghost"
      size="sm"
      icon={<Icon icon={ChatBubbleLeftEllipsisIcon} size="sm" />}
      onClick={onStartThread}
    />
  );
}

interface HermesMessageProps {
  content: string;
  createdAt: string;
  timing?: MessageTiming;
  thread?: ThreadReference;
  onQuote: (content: string) => void;
  onStartThread?: () => void;
}

export function HermesMessage({ content, createdAt, timing, thread, onQuote, onStartThread }: HermesMessageProps) {
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
            <StartThreadAction onStartThread={thread ? undefined : onStartThread} />
          </HStack>
        )}
      />
      {thread ? <ThreadLink reference={thread} /> : null}
    </ChatMessage>
  );
}

interface MemberMessageProps {
  author?: Member;
  isCurrentUser: boolean;
  content: string;
  createdAt: string;
  thread?: ThreadReference;
  onStartThread?: () => void;
}

export function MemberMessage({ author, isCurrentUser, content, createdAt, thread, onStartThread }: MemberMessageProps) {
  const metadata = (
    <ChatMessageMetadata
      timestamp={<Timestamp value={createdAt} format="time" />}
      footer={<StartThreadAction onStartThread={thread ? undefined : onStartThread} />}
    />
  );

  if (isCurrentUser) {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble metadata={metadata}>{content}</ChatMessageBubble>
        {thread ? <ThreadLink reference={thread} /> : null}
      </ChatMessage>
    );
  }

  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble name={author?.name} metadata={metadata}>{content}</ChatMessageBubble>
      {thread ? <ThreadLink reference={thread} /> : null}
    </ChatMessage>
  );
}

interface SnapshotEntryProps {
  content: string;
  authorName: string;
  sourceConversationId: string;
  sourceLabel: string;
}

export function SnapshotEntry({ content, authorName, sourceConversationId, sourceLabel }: SnapshotEntryProps) {
  return (
    <ChatMessage sender="assistant">
      <ChatMessageBubble variant="ghost" width="100%">
        <Blockquote cite={(
          <>
            {authorName === sourceLabel ? "From " : `${authorName} in `}
            <Link href={conversationHref(sourceConversationId)}>{sourceLabel}</Link>
          </>
        )}>
          <Markdown density="compact" contentWidth={760} headingLevelStart={3}>{content}</Markdown>
        </Blockquote>
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
