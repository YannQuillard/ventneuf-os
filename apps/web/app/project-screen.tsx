"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { AvatarGroup } from "@astryxdesign/core/AvatarGroup";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { CodeBracketIcon, RocketLaunchIcon, Squares2X2Icon, UserGroupIcon } from "@heroicons/react/24/outline";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { conversationHref, workspaceRequest, type WorkspaceConversation, type WorkspaceProject } from "../lib/workspace";
import { NewMissionDialog, NewProjectDialog, ShareResourceDialog } from "./_components/workspace-dialogs";
import { useWorkspaceNavigation } from "./workspace";

type ProjectView = "overview" | "missions" | "threads" | "access";
const views = new Set<ProjectView>(["overview", "missions", "threads", "access"]);

export function ProjectScreen({ projectId }: { projectId: string }) {
  const { snapshot, devices, isLoading, error, refreshWorkspace, isMobile, openNavigation } = useWorkspaceNavigation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedView = searchParams.get("view") as ProjectView | null;
  const view: ProjectView = requestedView && views.has(requestedView) ? requestedView : "overview";
  const [isShareOpen, setShareOpen] = useState(false);
  const [isEditOpen, setEditOpen] = useState(false);
  const [isMissionOpen, setMissionOpen] = useState(false);
  const project = snapshot?.projects.find((entry) => entry.id === projectId);

  if (isLoading) return <Layout height="fill" content={<LayoutContent padding={4}><EmptyState title="Loading project" /></LayoutContent>} />;
  if (!project) return <Layout height="fill" content={<LayoutContent padding={4}><VStack gap={3}>
    {error ? <Banner status="error" title="Unable to open project" description={error} /> : null}
    <EmptyState title="Project not found" description="It may be private, removed, or outside your current access." />
  </VStack></LayoutContent>} />;

  const conversations = (snapshot?.conversations ?? []).filter((conversation) => conversation.projectId === project.id);
  const missions = conversations.filter((conversation) => conversation.kind === "mission");
  const threads = conversations.filter((conversation) => conversation.kind !== "mission");
  const repositoryName = (association: WorkspaceProject["repositoryAssociations"][number]) => {
    const { deviceId, repositoryId } = association;
    const device = devices.find(({ id }) => id === deviceId);
    const repository = device?.repositories?.find(({ id }) => id === repositoryId) ?? association.repository;
    const isAvailableHere = devices.some((candidate) => candidate.repositories?.some((local) =>
      repository?.github && local.github
        ? repository.github.owner === local.github.owner && repository.github.name === local.github.name
        : candidate.id === deviceId && local.id === repositoryId));
    return { device: isAvailableHere ? "Available on your runner" : "Connect this GitHub repository on your Mac to run missions",
      repository: repository?.name ?? repositoryId };
  };
  const owner = snapshot?.members.find(({ id }) => id === project.ownerMemberId);
  const visibility = project.recipients.length ? `Shared with ${project.recipients.length}` : "Private project";

  const share = async (added: string[], removed: string[]) => {
    for (const memberId of added) await workspaceRequest(`/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(memberId)}`, { method: "PUT" });
    for (const memberId of removed) await workspaceRequest(`/projects/${encodeURIComponent(project.id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
    await refreshWorkspace();
  };
  const edit = async (input: { name: string; context?: { description: string }; repositoryAssociations: Array<{ deviceId: string; repositoryId: string }> }) => {
    await workspaceRequest<{ project: WorkspaceProject }>(`/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH", body: JSON.stringify(input),
    });
    await refreshWorkspace();
  };
  const createMission = async ({ title, objective }: { title: string; objective: string }) => {
    const { conversation } = await workspaceRequest<{ conversation: WorkspaceConversation }>("/conversations", {
      method: "POST", body: JSON.stringify({ title, kind: "mission", projectId: project.id }),
    });
    await workspaceRequest(`/conversations/${encodeURIComponent(conversation.id)}/messages`, {
      method: "POST", body: JSON.stringify({ content: objective }),
    });
    await refreshWorkspace();
    router.push(conversationHref(conversation));
  };

  const conversationList = (items: WorkspaceConversation[], emptyTitle: string, emptyDescription: string) => items.length ? (
    <List hasDividers density="compact">{items.map((conversation) => <ListItem key={conversation.id}
      label={conversation.title || (conversation.kind === "mission" ? "Untitled mission" : "Untitled thread")}
      description={<Text type="supporting">{conversation.recipients.length ? `Shared with ${conversation.recipients.map(({ name }) => name).join(", ")}` : "Private to its owner"} · <Timestamp value={conversation.updatedAt} format="auto" /></Text>}
      startContent={<Icon icon={conversation.kind === "mission" ? RocketLaunchIcon : Squares2X2Icon} color="secondary" />}
      href={conversationHref(conversation)} />)}</List>
  ) : <EmptyState title={emptyTitle} description={emptyDescription} isCompact />;

  const content = view === "missions" ? <VStack gap={3} padding={4}>{conversationList(missions, "No visible missions", "Start a private mission or ask a member to share one with you.")}</VStack>
    : view === "threads" ? <VStack gap={3} padding={4}>{conversationList(threads, "No visible project threads", "Threads appear here only when their owners share them with you.")}</VStack>
      : view === "access" ? <VStack gap={4} padding={4}>
        <Banner status="info" title="Project access is separate" description="Members listed here can open the project. They cannot discover private mission or topic threads unless each owner shares those resources explicitly." />
        <List hasDividers density="compact">
          {owner ? <ListItem label={owner.name} description="Owner" startContent={<Avatar name={owner.name} size="sm" />} /> : null}
          {project.recipients.map((member) => <ListItem key={member.id} label={member.name} description="Project member" startContent={<Avatar name={member.name} size="sm" />} />)}
        </List>
        {!project.recipients.length ? <Text type="supporting">Only the owner can access this project.</Text> : null}
      </VStack>
        : <VStack gap={6} padding={4}>
          <MetadataList title={<Heading level={2}>Project context</Heading>} label={{ position: "start", width: 140 }}>
            <MetadataListItem label="Visibility">{visibility}</MetadataListItem>
            <MetadataListItem label="Owner">{owner?.name ?? "Owner"}</MetadataListItem>
            <MetadataListItem label="Context">{typeof project.context.description === "string" ? project.context.description : "No project context has been added."}</MetadataListItem>
          </MetadataList>
          <VStack gap={2}><Heading level={2}>Repositories</Heading>
            {project.repositoryAssociations.length ? <List hasDividers density="compact">{project.repositoryAssociations.map((association) => {
              const names = repositoryName(association);
              return <ListItem key={association.id} label={names.repository} description={names.device}
                startContent={<Icon icon={CodeBracketIcon} color="secondary" />} />;
            })}</List> : <Text type="supporting">No repositories are associated with this project.</Text>}
          </VStack>
          <VStack gap={2}><Heading level={2}>Recent work</Heading>{conversationList(conversations.slice(0, 6), "No visible project work", "Create a mission to begin work in a dedicated thread.")}</VStack>
        </VStack>;

  return <>
    <Layout height="fill" header={<LayoutHeader hasDivider padding={3}><VStack gap={2}>
      <HStack gap={3} vAlign="center">
        {isMobile ? <IconButton label="Open workspace navigation" tooltip="Navigation" variant="ghost" size="sm"
          icon={<Icon icon="chevronLeft" size="sm" />} onClick={openNavigation} /> : null}
        <Icon icon={Squares2X2Icon} color="secondary" />
        <StackItem size="fill"><VStack gap={0}><Heading level={4} accessibilityLevel={1} maxLines={1}>{project.name}</Heading>
          <Text type="supporting" maxLines={1}>{visibility}</Text></VStack></StackItem>
        {!isMobile && project.recipients.length ? <AvatarGroup size="sm">{project.recipients.slice(0, 4).map((member) => <Avatar name={member.name} key={member.id} />)}</AvatarGroup> : null}
        {project.canManage && isMobile ? <MoreMenu label="Project options" size="sm" items={[
          { label: "Edit project", onClick: () => setEditOpen(true) },
          { label: "Share project", onClick: () => setShareOpen(true) },
        ]} /> : null}
        {project.canManage && !isMobile ? <Button label="Edit" variant="ghost" size="sm" onClick={() => setEditOpen(true)} /> : null}
        {project.canManage && !isMobile ? <Button label="Share" variant="secondary" size="sm" onClick={() => setShareOpen(true)} /> : null}
        <Button label={isMobile ? "Mission" : "New mission"} variant="primary" size="sm" onClick={() => setMissionOpen(true)} />
      </HStack>
      <TabList value={view} onChange={(next) => router.replace(`/projects/${encodeURIComponent(project.id)}?view=${next}`)} role="tablist" size="sm">
        <Tab value="overview" label="Overview" panelId="project-overview" />
        <Tab value="missions" label="Missions" panelId="project-missions" />
        <Tab value="threads" label="Threads" panelId="project-threads" />
        <Tab value="access" label="Access" panelId="project-access" icon={<Icon icon={UserGroupIcon} size="sm" />} />
      </TabList>
    </VStack></LayoutHeader>}
      content={<LayoutContent padding={0} label={`${project.name} ${view}`}><div id={`project-${view}`} role="tabpanel">{content}</div></LayoutContent>} />
    <NewMissionDialog isOpen={isMissionOpen} onOpenChange={setMissionOpen} projectName={project.name} onCreate={createMission} />
    <NewProjectDialog isOpen={isEditOpen} onOpenChange={setEditOpen} devices={devices}
      initial={{ name: project.name, context: typeof project.context.description === "string" ? project.context.description : "", repositoryAssociations: project.repositoryAssociations }} onCreate={edit} />
    <ShareResourceDialog isOpen={isShareOpen} onOpenChange={setShareOpen} resourceLabel="project"
      members={snapshot?.members ?? []} currentMemberId={snapshot?.currentMember.id ?? ""} recipients={project.recipients} onSave={share} />
  </>;
}
