"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, Layout, LayoutContent, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ChatBubbleLeftRightIcon, RocketLaunchIcon, Squares2X2Icon } from "@heroicons/react/24/outline";
import { conversationHref } from "../lib/workspace";
import { PageHeader } from "./_components/page-header";
import { useWorkspaceNavigation } from "./workspace";

export function WorkspaceHome() {
  const { isMobile, openNavigation, openNewConversation, openNewProject, snapshot, isLoading, error, refreshWorkspace } = useWorkspaceNavigation();
  const recent = [...(snapshot?.conversations ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  return <Layout height="fill" header={<PageHeader title="Workspace" subtitle="Conversations, memory, and project work"
    icon={ChatBubbleLeftRightIcon} onOpenNavigation={isMobile ? openNavigation : undefined}
    actions={<HStack gap={2}><Button label={isMobile ? "Chat" : "New chat"} variant="secondary" size="sm" onClick={openNewConversation} />
      <Button label={isMobile ? "Project" : "New project"} variant="primary" size="sm" onClick={openNewProject} /></HStack>} />}
    content={<LayoutContent padding={4} label="Workspace home"><VStack gap={6}>
      {error ? <Banner status="error" title="Workspace unavailable" description={error}
        endContent={<Button label="Retry" size="sm" variant="secondary" clickAction={refreshWorkspace} />} /> : null}
      {!isLoading && snapshot && !recent.length && !snapshot.projects.length ? <EmptyState
        title="Start with Hermes or a project" description="Private conversations and projects you can access will stay visible here."
        actions={<HStack gap={2}><Button label="New conversation" variant="primary" onClick={openNewConversation} />
          <Button label="Create project" variant="secondary" onClick={openNewProject} /></HStack>} /> : null}
      {recent.length ? <VStack gap={2}><Heading level={2}>Recent conversations</Heading><List hasDividers density="compact">
        {recent.map((conversation) => <ListItem key={conversation.id} label={conversation.title || "Untitled conversation"}
          description={conversation.kind === "mission" ? "Mission thread" : conversation.kind === "topic" ? "Topic thread" : "Conversation with Hermes"}
          startContent={<Icon icon={conversation.kind === "mission" ? RocketLaunchIcon : ChatBubbleLeftRightIcon} color="secondary" />}
          href={conversationHref(conversation)} />)}
      </List></VStack> : null}
      {snapshot?.projects.length ? <VStack gap={2}><HStack><StackItem size="fill"><Heading level={2}>Projects</Heading></StackItem></HStack>
        <List hasDividers density="compact">{snapshot.projects.map((project) => <ListItem key={project.id} label={project.name}
          description={typeof project.context.description === "string" ? project.context.description : (project.recipients.length ? `Shared with ${project.recipients.length}` : "Private project")}
          startContent={<Icon icon={Squares2X2Icon} color="secondary" />} href={`/projects/${encodeURIComponent(project.id)}`} />)}</List>
      </VStack> : null}
      {isLoading ? <Text type="supporting" role="status">Loading your workspace…</Text> : null}
    </VStack></LayoutContent>} />;
}
