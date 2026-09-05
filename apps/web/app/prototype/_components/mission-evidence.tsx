"use client";

import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { Lightbox } from "@astryxdesign/core/Lightbox";
import { List, ListItem } from "@astryxdesign/core/List";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { ArrowDownTrayIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";
import { formatElapsed } from "../../../lib/prototype/format";
import { screenshotPlaceholder } from "../../../lib/prototype/screenshot";
import type { EvidenceCheck, Mission } from "../../../lib/prototype/types";

const checkPresentation: Record<EvidenceCheck["status"], { dot: "success" | "error" | "accent" | "neutral"; label: string; isPulsing: boolean }> = {
  passed: { dot: "success", label: "Passed", isPulsing: false },
  failed: { dot: "error", label: "Failed", isPulsing: false },
  running: { dot: "accent", label: "Running", isPulsing: true },
  pending: { dot: "neutral", label: "Pending", isPulsing: false },
};

export function MissionEvidence({ mission }: { mission: Mission }) {
  const [lightboxIndex, setLightboxIndex] = useState<number>();
  const media = useMemo(() => mission.screenshots.map((screenshot, index) => ({
    src: screenshotPlaceholder({ label: screenshot.label, viewport: screenshot.viewport, hasIssue: index === 0 && mission.screenshots.length > 1 }),
    alt: screenshot.caption,
    caption: `${screenshot.label} · ${screenshot.viewport}`,
  })), [mission.screenshots]);

  if (mission.checks.length === 0 && mission.screenshots.length === 0 && mission.artifacts.length === 0) {
    return <EmptyState title="No evidence yet" description="Checks, screenshots, and artifacts appear here as the mission produces them." isCompact />;
  }

  return (
    <VStack gap={6} padding={4}>
      {mission.checks.length > 0 ? (
        <VStack gap={2}>
          <Heading level={3}>Checks</Heading>
          <List density="compact" hasDividers>
            {mission.checks.map((check) => {
              const presentation = checkPresentation[check.status];
              return (
                <ListItem
                  key={check.id}
                  label={check.label}
                  description={check.detail}
                  startContent={<StatusDot variant={presentation.dot} label={presentation.label} isPulsing={presentation.isPulsing} />}
                  endContent={<Text type="supporting" hasTabularNumbers>{formatElapsed(check.durationMs) ?? presentation.label}</Text>}
                />
              );
            })}
          </List>
        </VStack>
      ) : null}
      {mission.screenshots.length > 0 ? (
        <VStack gap={2}>
          <Heading level={3}>Browser evidence</Heading>
          <Grid columns={{ minWidth: 180, max: 3 }} gap={3}>
            {mission.screenshots.map((screenshot, index) => (
              <ClickableCard
                label={`Open ${screenshot.label}`}
                padding={2}
                variant="muted"
                onClick={() => setLightboxIndex(index)}
                className="prototype-screenshot"
                key={screenshot.id}
              >
                <VStack gap={1}>
                  <img src={media[index].src} alt={screenshot.caption} />
                  <Text type="supporting" color="primary" maxLines={2}>{screenshot.caption}</Text>
                  <Text type="supporting">
                    {`${screenshot.viewport} · `}
                    <Timestamp value={screenshot.capturedAt} format="time" />
                  </Text>
                </VStack>
              </ClickableCard>
            ))}
          </Grid>
          <Lightbox
            isOpen={lightboxIndex !== undefined}
            onOpenChange={(isOpen) => {
              if (!isOpen) setLightboxIndex(undefined);
            }}
            media={media}
            index={lightboxIndex ?? 0}
            onIndexChange={setLightboxIndex}
          />
        </VStack>
      ) : null}
      {mission.artifacts.length > 0 || mission.pullRequest ? (
        <VStack gap={2}>
          <Heading level={3}>Artifacts</Heading>
          <List density="compact" hasDividers>
            {mission.pullRequest ? (
              <ListItem
                label={`Pull request #${mission.pullRequest.number}`}
                description={mission.pullRequest.title}
                startContent={<Icon icon="externalLink" color="secondary" />}
                href={mission.pullRequest.url}
                target="_blank"
              />
            ) : null}
            {mission.artifacts.map((artifact) => (
              <ListItem
                key={artifact.id}
                label={artifact.label}
                description={`${artifact.kind} · ${artifact.size}`}
                startContent={<Icon icon={DocumentTextIcon} color="secondary" />}
                endContent={(
                  <IconButton
                    label={`Download ${artifact.label}`}
                    tooltip="Download"
                    variant="ghost"
                    size="sm"
                    icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
                  />
                )}
              />
            ))}
          </List>
        </VStack>
      ) : null}
    </VStack>
  );
}
