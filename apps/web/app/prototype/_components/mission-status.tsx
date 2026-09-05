"use client";

import { HStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { missionStatusPresentation } from "../../../lib/prototype/presentation";
import type { MissionStatus } from "../../../lib/prototype/types";

export function MissionStatusLabel({ status, detail }: { status: MissionStatus; detail?: string }) {
  const presentation = missionStatusPresentation[status];
  return (
    <HStack gap={2} vAlign="center">
      <StatusDot variant={presentation.dot} label={presentation.label} isPulsing={presentation.isPulsing} />
      <Text type="supporting" color="primary" weight="medium">{presentation.label}</Text>
      {detail ? <Text type="supporting">{`· ${detail}`}</Text> : null}
    </HStack>
  );
}
