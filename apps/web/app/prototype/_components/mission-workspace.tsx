"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { PROTOTYPE_NOW } from "../../../lib/prototype/fixtures";
import { elapsedBetween, formatElapsed } from "../../../lib/prototype/format";
import type { MissionTab } from "../../../lib/prototype/navigation";
import { agentPresentation } from "../../../lib/prototype/presentation";
import { isTerminal } from "../../../lib/prototype/state";
import type { Mission } from "../../../lib/prototype/types";
import { MissionActivity } from "./mission-activity";
import { MissionChanges } from "./mission-changes";
import { MissionEvidence } from "./mission-evidence";
import { MissionOverview } from "./mission-overview";
import { MissionStatusLabel } from "./mission-status";
import { MissionTerminal } from "./mission-terminal";
import { usePrototype } from "./prototype-provider";

interface MissionWorkspaceProps {
  mission: Mission;
  tab: MissionTab;
  onTabChange: (tab: MissionTab) => void;
  presentation: "panel" | "sheet";
  onClose: () => void;
}

function panelId(tab: MissionTab): string {
  return `mission-tab-panel-${tab}`;
}

export function MissionWorkspace({ mission, tab, onTabChange, presentation, onClose }: MissionWorkspaceProps) {
  const { data, cancelMission, retryMission } = usePrototype();
  const device = data.devices.find((entry) => entry.id === mission.deviceId);
  const isActive = !isTerminal(mission.status);
  const elapsed = formatElapsed(elapsedBetween(mission.startedAt, mission.endedAt ?? PROTOTYPE_NOW));
  const evidenceCount = mission.checks.length + mission.screenshots.length + mission.artifacts.length;

  const content = tab === "activity"
    ? <MissionActivity mission={mission} />
    : tab === "changes"
      ? <MissionChanges mission={mission} />
      : tab === "terminal"
        ? <MissionTerminal mission={mission} device={device} />
        : tab === "evidence"
          ? <MissionEvidence mission={mission} />
          : <MissionOverview mission={mission} device={device} />;

  return (
    <div className={presentation === "panel" ? "prototype-mission prototype-mission-panel" : "prototype-mission prototype-mission-sheet"}>
      <VStack gap={3} padding={4} paddingBlockEnd={2}>
        <HStack gap={3} vAlign="start">
          <StackItem size="fill">
            <VStack gap={1}>
              <MissionStatusLabel status={mission.status} detail={elapsed} />
              <Heading level={2} accessibilityLevel={2} maxLines={2}>{mission.title}</Heading>
              <Text type="supporting">
                {[agentPresentation[mission.agent].label, mission.model, device?.name, mission.repository].join(" · ")}
              </Text>
            </VStack>
          </StackItem>
          {presentation === "panel" ? (
            <IconButton
              label="Close the mission panel"
              tooltip="Close"
              variant="ghost"
              size="sm"
              icon={<Icon icon="close" size="sm" />}
              onClick={onClose}
            />
          ) : null}
        </HStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {isActive ? (
            <Button label="Stop mission" size="sm" variant="secondary" onClick={() => cancelMission(mission.id)} />
          ) : (
            <Button label="Retry mission" size="sm" variant="secondary" onClick={() => retryMission(mission.id)} />
          )}
          {mission.pullRequest ? (
            <Button
              label={`Pull request #${mission.pullRequest.number}`}
              size="sm"
              variant="secondary"
              href={mission.pullRequest.url}
              target="_blank"
              endContent={<Icon icon="externalLink" size="sm" />}
            />
          ) : null}
        </HStack>
      </VStack>
      <HStack paddingInline={2}>
        <TabList value={tab} onChange={(value) => onTabChange(value as MissionTab)} size="sm" hasDivider role="tablist" aria-label="Mission views">
          <Tab value="overview" label="Overview" panelId={panelId("overview")} />
          <Tab
            value="activity"
            label="Activity"
            panelId={panelId("activity")}
            endContent={<Text type="supporting" hasTabularNumbers>{mission.steps.length}</Text>}
          />
          <Tab
            value="changes"
            label="Changes"
            panelId={panelId("changes")}
            endContent={mission.files.length > 0 ? <Text type="supporting" hasTabularNumbers>{mission.files.length}</Text> : undefined}
          />
          <Tab
            value="terminal"
            label="Terminal"
            panelId={panelId("terminal")}
            endContent={isActive ? <StatusDot variant="accent" label="Live terminal" isPulsing /> : undefined}
          />
          <Tab
            value="evidence"
            label="Evidence"
            panelId={panelId("evidence")}
            endContent={evidenceCount > 0 ? <Text type="supporting" hasTabularNumbers>{evidenceCount}</Text> : undefined}
          />
        </TabList>
      </HStack>
      <div className="prototype-mission-body" role="tabpanel" id={panelId(tab)}>
        {content}
      </div>
    </div>
  );
}
