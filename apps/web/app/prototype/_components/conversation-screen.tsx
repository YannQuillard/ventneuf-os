"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { conversationHref, isMissionTab, missionHref, type MissionTab } from "../../../lib/prototype/navigation";
import { conversationById, memberById, messageById, missionsForConversation } from "../../../lib/prototype/state";
import { ConversationHeader } from "./conversation-header";
import { StartThreadDialog, type ThreadSource } from "./conversation-dialogs";
import { ConversationTimeline } from "./conversation-timeline";
import { MissionWorkspace } from "./mission-workspace";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const { data, dispatch, clock } = usePrototype();
  const { isCompact, navigate } = useShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversation = conversationById(data, conversationId);
  const missions = missionsForConversation(data, conversationId);
  const missionParam = searchParams.get("mission");
  const tabParam = searchParams.get("tab");
  const selectedMission = missionParam ? missions.find((mission) => mission.id === missionParam) : undefined;
  const tab: MissionTab = isMissionTab(tabParam) ? tabParam : "overview";
  const [threadSource, setThreadSource] = useState<ThreadSource>();
  const panel = useResizable({
    defaultSize: 480,
    minSizePx: 380,
    maxSizePx: 760,
    autoSaveId: "prototype-mission-panel",
  });

  const openMission = useCallback((missionId: string, nextTab?: MissionTab) => {
    router.push(missionHref(conversationId, missionId, nextTab));
  }, [conversationId, router]);

  const closeMission = useCallback(() => {
    router.push(conversationHref(conversationId));
  }, [conversationId, router]);

  const changeTab = useCallback((nextTab: MissionTab) => {
    if (!selectedMission) return;
    router.replace(missionHref(conversationId, selectedMission.id, nextTab));
  }, [conversationId, router, selectedMission]);

  const startThread = useCallback((messageId: string) => {
    const message = messageById(data, conversationId, messageId);
    if (!message || !conversation) return;
    const author = message.role === "hermes"
      ? "Hermes"
      : memberById(data, message.authorId ?? "")?.name ?? "You";
    setThreadSource({
      messageId,
      content: message.content,
      authorName: author,
      conversationLabel: conversation.kind === "project-channel" ? `#${conversation.title}` : conversation.title,
    });
  }, [conversation, conversationId, data]);

  const createThread = useCallback((title: string) => {
    if (!threadSource) return;
    const threadId = `thread-${Date.now().toString(36)}`;
    dispatch({ type: "startThread", threadId, conversationId, messageId: threadSource.messageId, title, at: clock() });
    setThreadSource(undefined);
    navigate(conversationHref(threadId));
  }, [clock, conversationId, dispatch, navigate, threadSource]);

  if (!conversation) {
    return (
      <EmptyState
        title="Conversation not found"
        description="Conversations created in the prototype live only in this browser session, so a reload forgets them."
        actions={<Button label="Open Hermes" variant="secondary" href={conversationHref("hermes")} />}
      />
    );
  }

  const showsPanel = Boolean(selectedMission) && !isCompact;

  return (
    <>
      <Layout
        height="fill"
        header={(
          <ConversationHeader
            conversation={conversation}
            missions={missions}
            onOpenMission={(missionId) => openMission(missionId)}
            onStartThread={startThread}
          />
        )}
        content={(
          <LayoutContent padding={0} isScrollable={false} label="Conversation">
            <div className="prototype-chat-region">
              {conversation.kind === "temporary" ? (
                <Banner
                  status="info"
                  container="section"
                  title="Temporary conversation"
                  description={(
                    <>
                      {"Discarded automatically "}
                      {conversation.expiresAt ? <Timestamp value={conversation.expiresAt} format="date_time" /> : "after 24 hours"}
                      {". Nothing here is written to durable knowledge."}
                    </>
                  )}
                  endContent={(
                    <Button
                      label="Keep"
                      size="sm"
                      variant="secondary"
                      onClick={() => dispatch({ type: "keepConversation", conversationId: conversation.id, at: clock() })}
                    />
                  )}
                  collapsible={false}
                />
              ) : null}
              <ConversationTimeline
                conversation={conversation}
                onOpenMission={openMission}
                onStartThread={startThread}
              />
            </div>
          </LayoutContent>
        )}
        end={showsPanel && selectedMission ? (
          <>
            <ResizeHandle
              direction="horizontal"
              resizable={panel.props}
              isReversed
              hasDivider
              pillPlacement="start"
              label="Resize the mission panel"
            />
            <LayoutPanel resizable={panel.props} hasDivider={false} padding={0} isScrollable={false} label="Mission details">
              <MissionWorkspace
                mission={selectedMission}
                tab={tab}
                onTabChange={changeTab}
                presentation="panel"
                onClose={closeMission}
              />
            </LayoutPanel>
          </>
        ) : undefined}
      />
      {isCompact ? (
        <BottomSheet
          isOpen={Boolean(selectedMission)}
          onOpenChange={(isOpen) => {
            if (!isOpen) closeMission();
          }}
          label="Mission details"
          height="tall"
        >
          {selectedMission ? (
            <MissionWorkspace
              mission={selectedMission}
              tab={tab}
              onTabChange={changeTab}
              presentation="sheet"
              onClose={closeMission}
            />
          ) : <span />}
        </BottomSheet>
      ) : null}
      <StartThreadDialog
        source={threadSource}
        onOpenChange={(isOpen) => {
          if (!isOpen) setThreadSource(undefined);
        }}
        onCreate={createThread}
      />
    </>
  );
}
