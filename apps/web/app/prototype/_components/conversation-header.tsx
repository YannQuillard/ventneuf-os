"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ChatBubbleLeftEllipsisIcon, ChatBubbleLeftRightIcon, ClockIcon, HashtagIcon } from "@heroicons/react/24/outline";
import { conversationHref, conversationTrail, projectHref } from "../../../lib/prototype/navigation";
import { missionStatusPresentation } from "../../../lib/prototype/presentation";
import { isTerminal, projectForConversation } from "../../../lib/prototype/state";
import type { Conversation, Mission } from "../../../lib/prototype/types";
import { formatCount } from "../../../lib/prototype/format";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

interface ConversationHeaderProps {
  conversation: Conversation;
  missions: Mission[];
  onOpenMission: (missionId: string) => void;
  onStartThread: (messageId: string) => void;
}

function scopeLabel(conversation: Conversation, projectName: string | undefined): string {
  if (conversation.knowledgeScope === "none") return "not written to memory";
  if (conversation.knowledgeScope === "project") return `${projectName ?? "project"} knowledge`;
  return "personal knowledge";
}

function headerIcon(conversation: Conversation) {
  if (conversation.kind === "project-channel") return HashtagIcon;
  if (conversation.kind === "thread") return ChatBubbleLeftEllipsisIcon;
  if (conversation.kind === "temporary") return ClockIcon;
  return ChatBubbleLeftRightIcon;
}

export function ConversationHeader({ conversation, missions, onOpenMission, onStartThread }: ConversationHeaderProps) {
  const { data, dispatch, clock } = usePrototype();
  const { isMobile, openNavigation, navigate } = useShell();
  const project = projectForConversation(data, conversation);
  const trail = conversationTrail(data, conversation);
  const parent = trail.length > 1 ? trail[trail.length - 2] : undefined;
  const latestMission = [...missions].sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
  const activeMission = missions.find((mission) => !isTerminal(mission.status)) ?? latestMission;
  const lastMessage = [...(data.entries[conversation.id] ?? [])].reverse().find((entry) => entry.kind === "message");
  const subtitle = conversation.kind === "thread"
    ? `Thread in ${parent?.kind === "project-channel" ? "#" : ""}${parent?.title ?? "conversation"} · ${scopeLabel(conversation, project?.name)}`
    : conversation.kind === "project-channel"
      ? `${formatCount(project?.members.length ?? 0, "member")} · ${scopeLabel(conversation, project?.name)}`
      : conversation.kind === "temporary"
        ? `Temporary · ${scopeLabel(conversation, undefined)}`
        : `Private · ${scopeLabel(conversation, undefined)}`;
  const status = activeMission ? missionStatusPresentation[activeMission.status] : undefined;
  const canArchive = conversation.kind !== "personal-main" && conversation.kind !== "project-channel";

  const archive = () => {
    dispatch({ type: "archiveConversation", conversationId: conversation.id, at: clock() });
    navigate(conversationHref(conversation.parentId ?? "hermes"));
  };

  return (
    <LayoutHeader hasDivider padding={3}>
      <HStack gap={3} vAlign="center">
        {isMobile ? (
          <IconButton
            label="Back to conversations"
            tooltip="Conversations"
            variant="ghost"
            size="sm"
            icon={<Icon icon="chevronLeft" />}
            onClick={openNavigation}
          />
        ) : null}
        <Icon icon={headerIcon(conversation)} color="secondary" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={4} accessibilityLevel={1} maxLines={1}>
              {conversation.kind === "project-channel" ? `#${conversation.title}` : conversation.title}
            </Heading>
            <Text type="supporting" maxLines={1}>{subtitle}</Text>
          </VStack>
        </StackItem>
        {project && !isMobile ? (
          <Button label="Project" size="sm" variant="ghost" href={projectHref(project.id)} />
        ) : null}
        {activeMission && status ? (
          <Button
            label={isMobile ? "Mission" : `Mission · ${status.label}`}
            size="sm"
            variant="ghost"
            icon={<StatusDot variant={status.dot} label={status.label} isPulsing={status.isPulsing} />}
            onClick={() => onOpenMission(activeMission.id)}
          />
        ) : null}
        <MoreMenu
          label="Conversation options"
          size="sm"
          items={[
            ...(conversation.kind === "temporary" ? [{
              label: "Keep this conversation",
              description: "Stop the 24-hour discard and use personal knowledge",
              onClick: () => dispatch({ type: "keepConversation", conversationId: conversation.id, at: clock() }),
            }] : []),
            {
              label: conversation.isPinned ? "Unpin" : "Pin",
              onClick: () => dispatch({ type: "togglePin", conversationId: conversation.id }),
              isDisabled: conversation.kind === "personal-main" || conversation.kind === "project-channel",
            },
            {
              label: "Start a thread from the last message",
              onClick: () => lastMessage && onStartThread(lastMessage.id),
              isDisabled: !lastMessage,
            },
            ...(project ? [{ label: "Open project", onClick: () => navigate(projectHref(project.id)) }] : []),
            { label: "Save summary to knowledge", isDisabled: true },
            { type: "divider" as const },
            { label: "Rename", isDisabled: true },
            {
              label: conversation.kind === "temporary" ? "Discard now" : "Archive",
              variant: "destructive" as const,
              onClick: archive,
              isDisabled: !canArchive,
            },
          ]}
        />
      </HStack>
    </LayoutHeader>
  );
}
