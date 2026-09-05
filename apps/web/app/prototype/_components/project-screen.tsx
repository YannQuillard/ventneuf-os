"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { pixel, proportional, Table } from "@astryxdesign/core/Table";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { BookOpenIcon, CodeBracketIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { PROTOTYPE_NOW } from "../../../lib/prototype/fixtures";
import { elapsedBetween, formatCost, formatCount, formatElapsed } from "../../../lib/prototype/format";
import { conversationHref, isProjectTab, missionHref, projectHref, type ProjectTab } from "../../../lib/prototype/navigation";
import { agentPresentation, missionStatusPresentation } from "../../../lib/prototype/presentation";
import { memberById } from "../../../lib/prototype/state";
import type { Mission, Project, Repository } from "../../../lib/prototype/types";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

interface MissionRow extends Record<string, unknown> {
  id: string;
  title: string;
  conversationId: string;
  threadTitle: string;
  agent: Mission["agent"];
  status: Mission["status"];
  startedAt: string;
  durationMs: number;
  costUsd?: number;
}

interface MemberRow extends Record<string, unknown> {
  id: string;
  name: string;
  role: string;
  devices: string;
  missions: number;
}

const metadataLabel = { position: "start", width: 128 } as const;

function capabilitySummary(device: { repositories: Array<{ repositoryId: string; capabilities: Record<string, boolean> }> }, repositoryId: string): string {
  const entry = device.repositories.find((repository) => repository.repositoryId === repositoryId);
  if (!entry) return "";
  const labels: Record<string, string> = { check: "check", review: "review", codexDevelopment: "Codex", claudeDevelopment: "Claude" };
  const enabled = Object.entries(entry.capabilities).filter(([, value]) => value).map(([key]) => labels[key]);
  return enabled.length > 0 ? enabled.join(", ") : "no capabilities";
}

export function ProjectScreen({ projectId }: { projectId: string }) {
  const { data } = usePrototype();
  const { isMobile, openNavigation } = useShell();
  const router = useRouter();
  const searchParams = useSearchParams();
  const project = data.projects.find((entry) => entry.id === projectId);
  const tabParam = searchParams.get("tab");
  const tab: ProjectTab = isProjectTab(tabParam) ? tabParam : "overview";

  if (!project) {
    return <EmptyState title="Project not found" description="This fixture project does not exist." />;
  }

  const threads = data.conversations.filter((conversation) => conversation.kind === "thread" && conversation.projectId === project.id && !conversation.isArchived);
  const conversationIds = new Set([project.channelId, ...threads.map((thread) => thread.id)]);
  const missions = data.missions
    .filter((mission) => conversationIds.has(mission.conversationId))
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  const repositories = data.repositories.filter((repository) => repository.projectId === project.id);
  const sources = data.knowledgeSources.filter((source) => source.projectId === project.id);
  const notes = data.knowledgeNotes
    .filter((note) => sources.some((source) => source.id === note.sourceId))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const activeDevices = data.devices.filter((device) => !device.isRevoked);
  const devicesFor = (repository: Repository) => activeDevices.filter((device) => device.repositories.some((entry) => entry.repositoryId === repository.id));
  const connectors = data.connectors.filter((connector) => connector.projectIds.includes(project.id));

  const missionRows: MissionRow[] = missions.map((mission) => ({
    id: mission.id,
    title: mission.title,
    conversationId: mission.conversationId,
    threadTitle: data.conversations.find((entry) => entry.id === mission.conversationId)?.title ?? "",
    agent: mission.agent,
    status: mission.status,
    startedAt: mission.startedAt,
    durationMs: elapsedBetween(mission.startedAt, mission.endedAt ?? PROTOTYPE_NOW),
    costUsd: mission.usage?.costUsd,
  }));

  const memberRows: MemberRow[] = project.members.map((projectMember) => {
    const member = memberById(data, projectMember.memberId);
    return {
      id: projectMember.memberId,
      name: member?.name ?? projectMember.memberId,
      role: projectMember.role === "owner" ? "Owner" : "Member",
      devices: activeDevices.filter((device) => device.ownerId === projectMember.memberId).map((device) => device.name).join(", ") || "None",
      missions: missions.filter((mission) => mission.initiatedById === projectMember.memberId).length,
    };
  });

  const changeTab = (next: string) => router.replace(projectHref(project.id, next as ProjectTab));

  const overview = (
    <VStack gap={6} padding={4}>
      <MetadataList title={<Heading level={3}>Project</Heading>} label={metadataLabel}>
        <MetadataListItem label="Channel">
          <Link href={conversationHref(project.channelId)}>{`#${project.name}`}</Link>
          {` · ${formatCount(threads.length, "thread")}`}
        </MetadataListItem>
        <MetadataListItem label="Members">
          {project.members.map((entry) => memberById(data, entry.memberId)?.name ?? entry.memberId).join(", ")}
        </MetadataListItem>
        <MetadataListItem label="Connectors">
          {connectors.length > 0 ? connectors.map((connector) => connector.name).join(", ") : "None"}
        </MetadataListItem>
        <MetadataListItem label="Knowledge">
          {sources.length > 0 ? sources.map((source) => `${source.name} · ${formatCount(source.noteCount, "note")}`).join(", ") : "No shared vault"}
        </MetadataListItem>
      </MetadataList>
      <VStack gap={2}>
        <Heading level={3}>Repositories</Heading>
        <List density="compact" hasDividers>
          {repositories.map((repository) => {
            const devices = devicesFor(repository);
            return (
              <ListItem
                key={repository.id}
                label={<Text type="code">{repository.name}</Text>}
                description={devices.length > 0
                  ? devices.map((device) => `${device.name}: ${capabilitySummary(device, repository.id)}`).join(" · ")
                  : "Not assigned to any enrolled device"}
                startContent={<Icon icon={CodeBracketIcon} color="secondary" />}
                endContent={<Text type="supporting" hasTabularNumbers>{repository.defaultBranch}</Text>}
              />
            );
          })}
        </List>
      </VStack>
      <MetadataList title={<Heading level={3}>Runner policy</Heading>} label={metadataLabel}>
        <MetadataListItem label="Pre-authorised">{project.policy.preAuthorised.join(", ")}</MetadataListItem>
        <MetadataListItem label="Hermes decides">
          {project.policy.hermesDiscretion.length > 0 ? project.policy.hermesDiscretion.join(", ") : "Nothing beyond the pre-authorised scope"}
        </MetadataListItem>
        <MetadataListItem label="You decide">{project.policy.memberGates.join(", ")}</MetadataListItem>
        <MetadataListItem label="Never">{project.policy.forbidden.join(", ")}</MetadataListItem>
        <MetadataListItem label="Budget">{`${project.policy.budgetMinutes} min per mission`}</MetadataListItem>
      </MetadataList>
    </VStack>
  );

  const missionsTable = missionRows.length === 0
    ? <EmptyState title="No missions yet" description="Missions launched from this project's threads appear here." isCompact />
    : (
      <Table
        data={missionRows}
        idKey="id"
        density="compact"
        hasHover
        textOverflow="truncate"
        columns={[
          {
            key: "title",
            header: "Mission",
            width: proportional(3),
            renderCell: (row) => (
              <VStack gap={0}>
                <Link href={missionHref(row.conversationId, row.id)}>{row.title}</Link>
                <Text type="supporting" maxLines={1}>{row.threadTitle}</Text>
              </VStack>
            ),
          },
          { key: "agent", header: "Agent", width: pixel(96), renderCell: (row) => agentPresentation[row.agent].label },
          {
            key: "status",
            header: "Status",
            width: pixel(160),
            renderCell: (row) => {
              const presentation = missionStatusPresentation[row.status];
              return (
                <HStack gap={2} vAlign="center">
                  <StatusDot variant={presentation.dot} label={presentation.label} isPulsing={presentation.isPulsing} />
                  <Text type="supporting" color="primary">{presentation.label}</Text>
                </HStack>
              );
            },
          },
          { key: "startedAt", header: "Started", width: pixel(140), renderCell: (row) => <Timestamp value={row.startedAt} format="date_time" /> },
          { key: "durationMs", header: "Duration", width: pixel(100), align: "end", renderCell: (row) => formatElapsed(row.durationMs) },
          { key: "costUsd", header: "Cost", width: pixel(80), align: "end", renderCell: (row) => row.costUsd === undefined ? "—" : formatCost(row.costUsd) },
        ]}
      />
    );

  const knowledge = (
    <VStack gap={6} padding={4}>
      <VStack gap={2}>
        <Heading level={3}>Sources</Heading>
        {sources.length > 0 ? (
          <List density="compact" hasDividers>
            {sources.map((source) => (
              <ListItem
                key={source.id}
                label={source.name}
                description={<Text type="code">{source.path}</Text>}
                startContent={<Icon icon={BookOpenIcon} color="secondary" />}
                endContent={(
                  <Text type="supporting">
                    {`${formatCount(source.noteCount, "note")} · synced `}
                    <Timestamp value={source.lastSyncAt} format="time" />
                  </Text>
                )}
              />
            ))}
          </List>
        ) : <Text type="supporting">No shared vault is configured for this project.</Text>}
      </VStack>
      <VStack gap={2}>
        <Heading level={3}>Recent notes</Heading>
        {notes.length > 0 ? (
          <List density="compact" hasDividers>
            {notes.map((note) => (
              <ListItem
                key={note.id}
                label={note.title}
                description={`${note.summary} · ${note.path}`}
                endContent={<Timestamp value={note.updatedAt} format="date" />}
              />
            ))}
          </List>
        ) : <Text type="supporting">Hermes has not written project notes yet.</Text>}
      </VStack>
    </VStack>
  );

  const members = (
    <Table
      data={memberRows}
      idKey="id"
      density="compact"
      hasHover
      columns={[
        {
          key: "name",
          header: "Member",
          width: proportional(2),
          renderCell: (row) => (
            <HStack gap={2} vAlign="center">
              <Avatar name={row.name} size="sm" tooltip={false} />
              <Text>{row.name}</Text>
            </HStack>
          ),
        },
        { key: "role", header: "Role", width: pixel(100) },
        { key: "devices", header: "Enrolled devices", width: proportional(2) },
        { key: "missions", header: "Missions initiated", width: pixel(150), align: "end" },
      ]}
    />
  );

  const content = tab === "missions" ? missionsTable : tab === "knowledge" ? knowledge : tab === "members" ? members : overview;

  return (
    <Layout
      height="fill"
      header={(
        <LayoutHeader hasDivider padding={3}>
          <VStack gap={2}>
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
              <Icon icon={Squares2X2Icon} color="secondary" />
              <StackItem size="fill">
                <VStack gap={0}>
                  <Heading level={4} accessibilityLevel={1} maxLines={1}>{project.name}</Heading>
                  <Text type="supporting" maxLines={1}>{project.description}</Text>
                </VStack>
              </StackItem>
              <AvatarGroup size="sm">
                {project.members.map((entry) => (
                  <Avatar name={memberById(data, entry.memberId)?.name} key={entry.memberId} />
                ))}
              </AvatarGroup>
              <Button label="Open channel" size="sm" variant="ghost" href={conversationHref(project.channelId)} />
            </HStack>
            <TabList value={tab} onChange={changeTab} size="sm" role="tablist" aria-label="Project views">
              <Tab value="overview" label="Overview" panelId="project-panel-overview" />
              <Tab value="missions" label="Missions" panelId="project-panel-missions" endContent={<Text type="supporting" hasTabularNumbers>{missions.length}</Text>} />
              <Tab value="knowledge" label="Knowledge" panelId="project-panel-knowledge" endContent={<Text type="supporting" hasTabularNumbers>{notes.length}</Text>} />
              <Tab value="members" label="Members" panelId="project-panel-members" endContent={<Text type="supporting" hasTabularNumbers>{project.members.length}</Text>} />
            </TabList>
          </VStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={0} label={`${project.name} ${tab}`}>
          <div role="tabpanel" id={`project-panel-${tab}`}>{content}</div>
        </LayoutContent>
      )}
    />
  );
}

export type { Project };
