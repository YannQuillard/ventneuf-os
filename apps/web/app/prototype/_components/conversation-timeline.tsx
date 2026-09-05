"use client";

import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
  type ChatComposerInputHandle,
} from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { PaperClipIcon } from "@heroicons/react/24/outline";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { MissionTab } from "../../../lib/prototype/navigation";
import {
  approvalById,
  approvalsForMission,
  conversationById,
  missionById,
  projectForConversation,
} from "../../../lib/prototype/state";
import type { Conversation, ConversationEntry } from "../../../lib/prototype/types";
import { ApprovalRequest } from "./approval-request";
import {
  HermesMessage,
  MemberMessage,
  MilestoneNote,
  SnapshotEntry,
  SystemNote,
  type ThreadReference,
} from "./conversation-entries";
import { MissionSummary } from "./mission-summary";
import { usePrototype } from "./prototype-provider";

interface ConversationTimelineProps {
  conversation: Conversation;
  onOpenMission: (missionId: string, tab?: MissionTab) => void;
  onStartThread: (messageId: string) => void;
}

function dayKey(value: string): string {
  return new Date(value).toDateString();
}

function scopeLabel(conversation: Conversation, projectName: string | undefined): string {
  if (conversation.knowledgeScope === "none") return "Not saved to memory";
  if (conversation.knowledgeScope === "project") return `${projectName ?? "Project"} knowledge`;
  return "Personal knowledge";
}

function conversationLabel(conversation: Conversation | undefined): string {
  if (!conversation) return "the conversation";
  return conversation.kind === "project-channel" ? `#${conversation.title}` : conversation.title;
}

export function ConversationTimeline({ conversation, onOpenMission, onStartThread }: ConversationTimelineProps) {
  const { data, sendMessage, cancelMission, retryMission, decideApproval } = usePrototype();
  const entries = data.entries[conversation.id] ?? [];
  const project = projectForConversation(data, conversation);
  const [content, setContent] = useState("");
  const [isAwaitingReply, setAwaitingReply] = useState(false);
  const composerInput = useRef<ChatComposerInputHandle>(null);
  const lastEntry = entries[entries.length - 1];

  useEffect(() => {
    if (lastEntry?.kind === "message" && lastEntry.role === "hermes") setAwaitingReply(false);
  }, [lastEntry]);

  const submit = useCallback((value: string) => {
    const message = value.trim();
    if (!message) return;
    setContent("");
    setAwaitingReply(true);
    sendMessage(conversation.id, message);
  }, [conversation.id, sendMessage]);

  const quote = useCallback((value: string) => {
    setContent(`${value.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`);
    composerInput.current?.focus();
  }, []);

  const redirect = useCallback((agentLabel: string) => {
    setContent(`Redirect ${agentLabel}: `);
    composerInput.current?.focus();
  }, []);

  const threadReference = (threadId: string | undefined): ThreadReference | undefined => {
    const thread = threadId ? conversationById(data, threadId) : undefined;
    if (!thread || thread.isArchived) return undefined;
    const replyCount = (data.entries[thread.id] ?? []).filter((entry) => entry.kind === "message").length;
    return { thread, replyCount };
  };

  const renderEntry = (entry: ConversationEntry) => {
    if (entry.kind === "message" && entry.role === "hermes") {
      return (
        <HermesMessage
          content={entry.content}
          createdAt={entry.createdAt}
          timing={entry.timing}
          thread={threadReference(entry.threadId)}
          onQuote={quote}
          onStartThread={() => onStartThread(entry.id)}
        />
      );
    }
    if (entry.kind === "message") {
      const author = entry.authorId ? data.members.find((member) => member.id === entry.authorId) : undefined;
      return (
        <MemberMessage
          author={author}
          isCurrentUser={!author || Boolean(author.isCurrentUser)}
          content={entry.content}
          createdAt={entry.createdAt}
          thread={threadReference(entry.threadId)}
          onStartThread={() => onStartThread(entry.id)}
        />
      );
    }
    if (entry.kind === "system") {
      return <SystemNote icon={entry.icon} content={entry.content} createdAt={entry.createdAt} />;
    }
    if (entry.kind === "snapshot") {
      return (
        <SnapshotEntry
          content={entry.content}
          authorName={entry.authorName}
          sourceConversationId={entry.sourceConversationId}
          sourceLabel={conversationLabel(conversationById(data, entry.sourceConversationId))}
        />
      );
    }
    if (entry.kind === "milestone") {
      return <MilestoneNote title={entry.title} description={entry.description} href={entry.href} createdAt={entry.createdAt} />;
    }
    if (entry.kind === "mission") {
      const mission = missionById(data, entry.missionId);
      if (!mission) return null;
      return (
        <ChatMessage sender="assistant">
          <ChatMessageBubble variant="ghost" width="100%">
            <MissionSummary
              mission={mission}
              approvals={approvalsForMission(data, mission.id)}
              device={data.devices.find((device) => device.id === mission.deviceId)}
              onOpen={(tab) => onOpenMission(mission.id, tab)}
              onStop={() => cancelMission(mission.id)}
              onRetry={() => retryMission(mission.id)}
              onRedirect={() => redirect(mission.agent === "codex" ? "Codex" : "Claude")}
            />
          </ChatMessageBubble>
        </ChatMessage>
      );
    }
    const approval = approvalById(data, entry.approvalId);
    const mission = approval ? missionById(data, approval.missionId) : undefined;
    if (!approval || !mission) return null;
    return (
      <ChatMessage sender="assistant">
        <ChatMessageBubble variant="ghost" width="100%">
          <ApprovalRequest
            approval={approval}
            mission={mission}
            onDecide={(outcome) => decideApproval(approval.id, outcome)}
            onOpenMission={() => onOpenMission(mission.id, "activity")}
          />
        </ChatMessageBubble>
      </ChatMessage>
    );
  };

  return (
    <ChatLayout
      className="prototype-chat"
      composer={(
        <ChatComposer
          value={content}
          onChange={setContent}
          onSubmit={submit}
          placeholder={conversation.kind === "project-channel" ? `Message #${conversation.title}` : "Message Hermes"}
          headerActions={(
            <IconButton
              label="Attach a file or screenshot"
              tooltip="Attach"
              variant="ghost"
              size="sm"
              icon={<Icon icon={PaperClipIcon} size="sm" />}
            />
          )}
          footerActions={<Text type="supporting">{scopeLabel(conversation, project?.name)}</Text>}
          input={<ChatComposerInput handleRef={composerInput} />}
        />
      )}
    >
      <ChatMessageList isStreaming={isAwaitingReply}>
        {entries.map((entry, index) => {
          const previous = entries[index - 1];
          const isDayStart = !previous || dayKey(previous.createdAt) !== dayKey(entry.createdAt);
          return (
            <Fragment key={entry.id}>
              {isDayStart ? (
                <ChatSystemMessage variant="divider">
                  <Timestamp value={entry.createdAt} format="date_weekday" hasTooltip={false} />
                </ChatSystemMessage>
              ) : null}
              {renderEntry(entry)}
            </Fragment>
          );
        })}
        {isAwaitingReply ? (
          <ChatMessage sender="assistant">
            <ChatMessageBubble variant="ghost" name="Hermes">
              <HStack gap={2} vAlign="center" role="status">
                <Spinner size="sm" aria-label="Hermes is working" />
                <Text type="supporting">Hermes is working</Text>
              </HStack>
            </ChatMessageBubble>
          </ChatMessage>
        ) : null}
      </ChatMessageList>
    </ChatLayout>
  );
}
