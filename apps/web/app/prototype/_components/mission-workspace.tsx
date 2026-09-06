"use client";

import { Button } from "@astryxdesign/core/Button";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { PROTOTYPE_NOW } from "../../../lib/prototype/fixtures";
import { elapsedBetween, formatElapsed } from "../../../lib/prototype/format";
import type { MissionTab } from "../../../lib/prototype/navigation";
import { agentPresentation } from "../../../lib/prototype/presentation";
import { isTerminal } from "../../../lib/prototype/state";
import type { Mission } from "../../../lib/prototype/types";
import { MissionWorkspaceFrame } from "../../_components/mission-workspace";
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
    <MissionWorkspaceFrame
      title={mission.title}
      subtitle={[agentPresentation[mission.agent].label, mission.model, device?.name, mission.repository].filter(Boolean).join(" · ")}
      status={<MissionStatusLabel status={mission.status} detail={elapsed} />}
      presentation={presentation} onClose={onClose} tab={tab} onTabChange={(value) => onTabChange(value as MissionTab)}
      tabs={[
        { id: "overview", label: "Overview" },
        { id: "activity", label: "Activity", endContent: <Text type="supporting" hasTabularNumbers>{mission.steps.length}</Text> },
        { id: "changes", label: "Changes" },
        { id: "terminal", label: "Terminal" },
        { id: "evidence", label: "Evidence", endContent: evidenceCount ? <Text type="supporting">{evidenceCount}</Text> : undefined },
      ]}
      actions={<>
        {isActive ? <Button label="Stop mission" size="sm" variant="secondary" onClick={() => cancelMission(mission.id)} />
          : <Button label="Retry mission" size="sm" variant="secondary" onClick={() => retryMission(mission.id)} />}
        {mission.pullRequest ? <Button label={`Pull request #${mission.pullRequest.number}`} size="sm" variant="secondary"
          href={mission.pullRequest.url} target="_blank" endContent={<Icon icon="externalLink" size="sm" />} /> : null}
      </>}
    >{content}</MissionWorkspaceFrame>
  );
}
