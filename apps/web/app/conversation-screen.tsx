"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HStack, Layout, LayoutContent, VStack } from "@astryxdesign/core/Layout";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { conversationHref, workspaceRequest, type WorkspaceConversation } from "../lib/workspace";
import { DeleteMissionDialog, NewThreadDialog, ShareResourceDialog } from "./_components/workspace-dialogs";
import { HermesConversation } from "./conversation";
import { useWorkspaceNavigation } from "./workspace";

export function WorkspaceConversationScreen({ conversationId, expectedProjectId }: { conversationId: string; expectedProjectId?: string }) {
  const { snapshot, isLoading, error, refreshWorkspace, openNewConversation, isMobile } = useWorkspaceNavigation();
  const router = useRouter();
  const [isDeleteOpen, setDeleteOpen] = useState(false);
  const deleting = useRef(false);
  const [isShareOpen, setShareOpen] = useState(false);
  const [isThreadOpen, setThreadOpen] = useState(false);
  const conversation = snapshot?.conversations.find((entry) => entry.id === conversationId);

  if (isLoading) return <Layout height="fill" content={<LayoutContent padding={4}><EmptyState title="Loading conversation" /></LayoutContent>} />;
  if (!snapshot || !conversation || (expectedProjectId && conversation.projectId !== expectedProjectId)) {
    return <Layout height="fill" content={<LayoutContent padding={4}><VStack gap={3}>
      {error ? <Banner status="error" title="Unable to open conversation" description={error} /> : null}
      <EmptyState title="Conversation not found" description="It may be private, removed, or outside your current access."
        actions={<Button label="New conversation" variant="primary" onClick={openNewConversation} />} />
    </VStack></LayoutContent>} />;
  }

  const project = conversation.projectId ? snapshot?.projects.find(({ id }) => id === conversation.projectId) : undefined;
  const parent = conversation.parentConversationId ? snapshot?.conversations.find(({ id }) => id === conversation.parentConversationId) : undefined;
  const visibility = conversation.recipients.length
    ? `Shared with ${conversation.recipients.map(({ name }) => name).join(", ")}`
    : "Private to you";
  const context = conversation.kind === "mission" && project ? `Mission in ${project.name}`
    : conversation.kind === "topic" && parent ? `Topic from ${parent.title}`
      : "Conversation with Hermes";
  const eligibleMembers = project
    ? snapshot.members.filter((member) => member.id === project.ownerMemberId || project.recipients.some(({ id }) => id === member.id))
    : snapshot.members;

  const share = async (added: string[], removed: string[]) => {
    for (const memberId of added) await workspaceRequest(`/conversations/${encodeURIComponent(conversation.id)}/members/${encodeURIComponent(memberId)}`, { method: "PUT" });
    for (const memberId of removed) await workspaceRequest(`/conversations/${encodeURIComponent(conversation.id)}/members/${encodeURIComponent(memberId)}`, { method: "DELETE" });
    await refreshWorkspace();
  };
  const createThread = async (title: string) => {
    const { conversation: thread } = await workspaceRequest<{ conversation: WorkspaceConversation }>("/conversations", {
      method: "POST",
      body: JSON.stringify({ title, kind: "topic", parentConversationId: conversation.id, projectId: conversation.projectId }),
    });
    await refreshWorkspace();
    router.push(conversationHref(thread));
  };

  const deleteMission = async () => {
    deleting.current = true;
    try {
      await workspaceRequest(`/conversations/${encodeURIComponent(conversation.id)}`, { method: "DELETE" });
      await refreshWorkspace();
      router.replace(conversation.projectId ? `/projects/${encodeURIComponent(conversation.projectId)}` : "/");
    } catch (error) { deleting.current = false; throw error; }
  };

  const headerActions = <>
    {conversation.kind !== "mission" ? <Button label={isMobile ? "Thread" : "Start thread"} size="sm" variant="ghost" onClick={() => setThreadOpen(true)} /> : null}
    {conversation.kind === "mission" && conversation.canManage && conversation.canDelete ? <Button label="Delete mission" size="sm" variant="ghost" onClick={() => setDeleteOpen(true)} /> : null}
    {conversation.canManage ? <Button label="Share" size="sm" variant="secondary" onClick={() => setShareOpen(true)} /> : null}
  </>;

  return <>
    <HermesConversation conversationId={conversation.id} title={conversation.title || "Untitled conversation"}
      subtitle={`${context} · ${visibility}`} headerActions={headerActions}
      showSuggestions={conversation.kind === "private"}
      onAccessRevoked={() => { if (!deleting.current) { void refreshWorkspace(); router.replace("/"); } }} />
    <DeleteMissionDialog isOpen={isDeleteOpen} onOpenChange={setDeleteOpen} title={conversation.title} onDelete={deleteMission} />
    <NewThreadDialog isOpen={isThreadOpen} onOpenChange={setThreadOpen} parentTitle={conversation.title} onCreate={createThread} />
    <ShareResourceDialog isOpen={isShareOpen} onOpenChange={setShareOpen}
      resourceLabel={conversation.kind === "mission" ? "mission thread" : conversation.kind === "topic" ? "topic thread" : "conversation"}
      members={eligibleMembers} currentMemberId={snapshot.currentMember.id} recipients={conversation.recipients} onSave={share} />
  </>;
}
