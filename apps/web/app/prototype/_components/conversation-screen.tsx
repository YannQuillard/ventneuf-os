"use client";

import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Layout, LayoutContent, LayoutPanel } from "@astryxdesign/core/Layout";
import { ResizeHandle, useResizable } from "@astryxdesign/core/Resizable";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { conversationHref, isMissionTab, missionHref, type MissionTab } from "../../../lib/prototype/navigation";
import { conversationById, missionsForConversation } from "../../../lib/prototype/state";
import { ConversationHeader } from "./conversation-header";
import { ConversationTimeline } from "./conversation-timeline";
import { MissionWorkspace } from "./mission-workspace";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

export function ConversationScreen({ conversationId }: { conversationId: string }) {
  const { data } = usePrototype();
  const { isCompact } = useShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const conversation = conversationById(data, conversationId);
  const missions = missionsForConversation(data, conversationId);
  const missionParam = searchParams.get("mission");
  const tabParam = searchParams.get("tab");
  const selectedMission = missionParam ? missions.find((mission) => mission.id === missionParam) : undefined;
  const tab: MissionTab = isMissionTab(tabParam) ? tabParam : "overview";
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

  if (!conversation) {
    return <EmptyState title="Conversation not found" description="This fixture conversation does not exist." />;
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
          />
        )}
        content={(
          <LayoutContent padding={0} isScrollable={false} label="Conversation">
            <ConversationTimeline
              conversation={conversation}
              onOpenMission={openMission}
            />
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
    </>
  );
}
