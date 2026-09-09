"use client";

import { BottomSheet } from "@astryxdesign/core/BottomSheet";
import { useMediaQuery } from "@astryxdesign/core/hooks";
import { missionStatusPresentation } from "../lib/mission-presentation";
import executionStyles from "./agent-execution.module.css";
import { PageHeader } from "./_components/page-header";
import { AssistantMessage } from "./_components/assistant-message";
import { ConversationSurface } from "./_components/conversation-surface";
import { useWorkspaceNavigation } from "./workspace";
import { ChatBubbleLeftRightIcon } from "@heroicons/react/24/outline";
import {
  ChatMessageList,
  ChatSystemMessage,
  type ChatComposerInputHandle,
} from "@astryxdesign/core/Chat";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack, Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDuration, type Message, type MissionApproval, type MissionEvent, type MissionState, type MissionTiming } from "../lib/conversations";
import { missionActivities } from "../lib/mission-activity";
import { ConversationMessage } from "./conversation-message";
import { MessageDetailsPanel } from "./message-details";
import { AgentExecutionPanel } from "./agent-execution";
import type { AgentExecution } from "../lib/agent-execution";
import { MissionApprovalRequest } from "./_components/mission-approval";

const chatColumn: CSSProperties = { flex: 1, minWidth: 0, height: "100%" };

const suggestions = [
  {
    heading: "Daily recap",
    body: "Turn today into a dated note in the vault.",
    prompt: "Write a recap of today from my vault and save it as today's daily note.",
  },
  {
    heading: "Plan the week",
    body: "Draft priorities from the threads still open.",
    prompt: "Draft a plan for next week from the open threads in my vault.",
  },
  {
    heading: "Summarize a document",
    body: "Pull the key points out of a long note.",
    prompt: "Summarize the key points of the note I edited most recently.",
  },
  {
    heading: "Propose a mission",
    body: "Suggest the next piece of work worth running.",
    prompt: "Propose the next mission worth running and explain why it matters now.",
  },
];

interface PendingMessage {
  id: string;
  content: string;
  createdAt: string;
  hasFailed: boolean;
}

function dayKey(value: string) {
  return new Date(value).toDateString();
}

function quoted(content: string) {
  return `${content.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
}

function lastAssistantRetry(messages: Message[], currentMemberId?: string) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if (messages[earlier].role === "user") {
        const memberId = messages[earlier].memberId;
        return !memberId || memberId === currentMemberId
          ? { id: messages[index].id, prompt: messages[earlier].content }
          : undefined;
      }
    }
    return undefined;
  }
  return undefined;
}

export function HermesConversation({ conversationId, title = "Hermes", subtitle = "Private · personal knowledge", headerActions, onAccessRevoked, showSuggestions = true, collaborative = false }: {
  conversationId?: string;
  title?: string;
  subtitle?: string;
  headerActions?: React.ReactNode;
  onAccessRevoked?: () => void;
  showSuggestions?: boolean;
  collaborative?: boolean;
}) {
  const { isMobile, openNavigation, snapshot } = useWorkspaceNavigation();
  const currentMemberId = snapshot?.currentMember.id;
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [content, setContent] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [revealingId, setRevealingId] = useState<string>();
  const [mission, setMission] = useState<MissionState | null>(null);
  const [missionEvents, setMissionEvents] = useState<MissionEvent[]>([]);
  const [approvals, setApprovals] = useState<MissionApproval[]>([]);
  const [isAgentOpen, setIsAgentOpen] = useState(false);
  const isCompact = useMediaQuery("(max-width: 1100px)");
  const [agentExecution, setAgentExecution] = useState<AgentExecution | null>(null);
  const executionActive = Boolean(agentExecution && ["queued", "running", "waiting_for_approval"].includes(agentExecution.status));
  const [selectedMessageId, setSelectedMessageId] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const [isStopping, setIsStopping] = useState(false);
  const latestUserMessageAt = useRef<number | undefined>(undefined);
  const composerInput = useRef<ChatComposerInputHandle>(null);
  const acceptedMessages = useRef<Message[]>([]);
  const pendingCount = useRef(0);
  const activities = missionActivities(missionEvents);
  const visibleActivities = activities.slice(-6);

  const messageEndpoint = conversationId
    ? `/api/workspace/conversations/${encodeURIComponent(conversationId)}/messages`
    : "/api/hermes/messages";
  const eventEndpoint = conversationId
    ? `/api/workspace/conversations/${encodeURIComponent(conversationId)}/events`
    : "/api/hermes/events";

  const revokeAccess = useCallback(() => {
    setAccessRevoked(true);
    acceptedMessages.current = [];
    setMessages([]);
    setPending([]);
    setMission(null);
    setMissionEvents([]);
    setApprovals([]);
    setAgentExecution(null);
    setAwaitingReply(false);
    setError("Your access to this conversation has changed.");
    onAccessRevoked?.();
  }, [onAccessRevoked]);

  const refresh = useCallback(async () => {
    const response = await fetch(messageEndpoint, { cache: "no-store" });
    if (conversationId && (response.status === 403 || response.status === 404)) {
      revokeAccess();
      return;
    }
    if (!response.ok) throw new Error("Unable to load the conversation.");
    const payload = await response.json() as {
      messages: Message[];
      mission: MissionState | null;
      events: MissionEvent[];
      agentExecution?: AgentExecution | null;
      approvals?: MissionApproval[];
    };
    const knownIds = new Set(payload.messages.map(({ id }) => id));
    acceptedMessages.current = acceptedMessages.current.filter(({ id }) => !knownIds.has(id));
    setMessages(acceptedMessages.current.length > 0
      ? [...payload.messages, ...acceptedMessages.current]
      : payload.messages);
    setAgentExecution(payload.agentExecution ?? null);
    setMission(payload.mission ?? null);
    setMissionEvents(payload.events ?? []);
    setApprovals(payload.approvals ?? []);
    setAccessRevoked(false);
    setError(undefined);
    setIsLoaded(true);
    if (payload.mission) {
      setAwaitingReply(payload.mission.status === "queued" || payload.mission.status === "running");
      if (payload.mission.status === "failed") {
        setError(payload.mission.failure ?? "The mission could not complete.");
      }
    }
    const lastMessage = payload.messages.at(-1);
    if (
      latestUserMessageAt.current
      && lastMessage?.role === "assistant"
      && new Date(lastMessage.createdAt).getTime() >= latestUserMessageAt.current
    ) {
      setAwaitingReply(false);
      setRevealingId(lastMessage.id);
      latestUserMessageAt.current = undefined;
    }
  }, [conversationId, messageEndpoint, revokeAccess]);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await refresh();
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Unable to load the conversation.");
      }
      if (!stopped) timer = window.setTimeout(poll, awaitingReply || executionActive ? 1_500 : 5_000);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [awaitingReply, executionActive, refresh]);

  useEffect(() => {
    if (!awaitingReply && !executionActive) return;
    const source = new EventSource(eventEndpoint);
    source.addEventListener("snapshot", (raw) => {
      const payload = JSON.parse((raw as MessageEvent<string>).data) as {
        mission: MissionState | null;
        events: MissionEvent[];
      agentExecution?: AgentExecution | null;
      approvals?: MissionApproval[];
      };
      setAgentExecution(payload.agentExecution ?? null);
      setMission(payload.mission);
      setMissionEvents(payload.events);
      setApprovals(payload.approvals ?? []);
      if (payload.mission && !["queued", "running", "waiting_for_approval"].includes(payload.mission.status)) {
        setAwaitingReply(false);
        void refresh();
      }
    });
    source.addEventListener("access_revoked", revokeAccess);
    return () => source.close();
  }, [awaitingReply, eventEndpoint, executionActive, refresh, revokeAccess]);

  useEffect(() => {
    if (!awaitingReply) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [awaitingReply]);

  const submit = useCallback(async (value: string) => {
    const message = value.trim();
    if (!message || accessRevoked) return;
    pendingCount.current += 1;
    const pendingId = `pending-${pendingCount.current}`;
    setPending((current) => [
      ...current,
      { id: pendingId, content: message, createdAt: new Date().toISOString(), hasFailed: false },
    ]);
    setError(undefined);
    try {
      const response = await fetch(messageEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: message, ...(collaborative ? { delivery: "project_chat" } : {}) }),
      });
      if (!response.ok) throw new Error("Hermes could not accept the message.");
      const payload = await response.json() as {
        message: Message;
        missionId: string;
        status: MissionState["status"];
        timing: MissionTiming;
      };
      acceptedMessages.current = [...acceptedMessages.current, payload.message];
      latestUserMessageAt.current = collaborative ? undefined : new Date(payload.message.createdAt).getTime();
      setMessages((current) => current.some(({ id }) => id === payload.message.id)
        ? current
        : [...current, payload.message]);
      setPending((current) => current.filter(({ id }) => id !== pendingId));
      setAwaitingReply(!collaborative);
      setMission(!collaborative && payload.missionId
        ? { id: payload.missionId, status: payload.status, timing: payload.timing }
        : null);
      setNow(Date.now());
    } catch {
      setPending((current) => current.map((entry) => entry.id === pendingId
        ? { ...entry, hasFailed: true }
        : entry));
    }
  }, [accessRevoked, collaborative, messageEndpoint]);

  const resend = useCallback((prompt: string, pendingId?: string) => {
    if (pendingId) setPending((current) => current.filter(({ id }) => id !== pendingId));
    void submit(prompt);
  }, [submit]);

  const dismiss = useCallback((pendingId: string) => {
    setPending((current) => current.filter(({ id }) => id !== pendingId));
  }, []);

  const stopMission = useCallback(async (missionId: string) => {
    setIsStopping(true);
    try {
      const response = await fetch(conversationId
        ? `/api/workspace/conversations/${encodeURIComponent(conversationId)}/missions/${encodeURIComponent(missionId)}/cancel`
        : `/api/hermes/missions/${encodeURIComponent(missionId)}/cancel`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Hermes could not stop this run.");
      if (mission?.id === missionId) setAwaitingReply(false);
      setMission((current) => current?.id === missionId ? { ...current, status: "cancelled" } : current);
      setAgentExecution((current) => current?.missionId === missionId ? { ...current, status: "cancelled" } : current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hermes could not stop this run.");
    } finally {
      setIsStopping(false);
    }
  }, [conversationId, mission]);

  const quote = useCallback((value: string) => {
    setContent(quoted(value));
    composerInput.current?.focus();
  }, []);

  const edit = useCallback((value: string) => {
    setContent(value);
    composerInput.current?.focus();
  }, []);

  const completeReveal = useCallback(() => setRevealingId(undefined), []);

  const inspect = useCallback((id: string) => {
    setSelectedMessageId((current) => current === id ? undefined : id);
  }, []);

  const closeDetails = useCallback(() => setSelectedMessageId(undefined), []);

  const timeline = pending.length > 0
    ? [
      ...messages,
      ...pending.map(({ id, content: text, createdAt }): Message => ({
        id,
        role: "user",
        content: text,
        createdAt,
        memberId: currentMemberId,
      })),
    ]
    : messages;
  const pendingById = new Map(pending.map((entry) => [entry.id, entry]));
  const retry = lastAssistantRetry(messages, currentMemberId);
  const selected = selectedMessageId === undefined
    ? undefined
    : timeline.find(({ id }) => id === selectedMessageId);

  useEffect(() => {
    if (selectedMessageId !== undefined && selected === undefined) setSelectedMessageId(undefined);
  }, [selected, selectedMessageId]);

  return (
    <>
      <Layout height="fill" header={
        <PageHeader title={title} subtitle={subtitle} icon={ChatBubbleLeftRightIcon}
          onOpenNavigation={isMobile ? openNavigation : undefined}
          actions={<HStack gap={2}>{headerActions}{agentExecution ? <Button
            label={isMobile ? "Mission" : `Mission · ${missionStatusPresentation[agentExecution.status].label}`}
            variant="ghost" size="sm" clickAction={() => setIsAgentOpen(true)} /> : null}</HStack>} />
      } content={<LayoutContent padding={0} isScrollable={false}>
      <HStack height="100%">
        <VStack style={chatColumn}>
          <ConversationSurface value={content} onChange={setContent} inputRef={composerInput} error={error}
            isDisabled={accessRevoked || !isLoaded}
            placeholder={collaborative ? "Message the project · use @name to notify someone" : "Message Hermes"}
            scope={collaborative ? "Shared project conversation" : conversationId ? "Conversation knowledge" : "Personal knowledge"}
            onSubmit={(value) => { setContent(""); void submit(value); }}
            emptyState={error ? <Text type="supporting">{accessRevoked
              ? "Ask the project or conversation owner to restore your access."
              : "The conversation could not load. Retrying automatically…"}</Text> : isLoaded ? (
              <VStack gap={6} hAlign="center" width="100%" maxWidth={560} padding={4}>
                <EmptyState
                  title={collaborative ? "Start the project conversation" : "Ask Hermes anything"}
                  description={collaborative
                    ? "Messages are visible to everyone in the project. Mention a member with @name to notify them."
                    : conversationId
                    ? "Send a message to get started. Access follows this conversation's sharing settings."
                    : "This conversation is private to you. Send a message to get started."}
                />
                {showSuggestions ? <Grid columns={{ minWidth: 200, max: 2 }} gap={3} width="100%">
                  {suggestions.map((suggestion) => (
                    <ClickableCard
                      label={suggestion.heading}
                      variant="muted"
                      padding={3}
                      onClick={() => void submit(suggestion.prompt)}
                      key={suggestion.heading}
                    >
                      <VStack gap={0.5}>
                        <Heading level={4}>{suggestion.heading}</Heading>
                        <Text type="body" color="secondary" size="xsm">{suggestion.body}</Text>
                      </VStack>
                    </ClickableCard>
                  ))}
                </Grid> : null}
              </VStack>
            ) : (
              <Spinner aria-label="Loading the conversation" />
            )}
          >
            {timeline.length > 0 || awaitingReply ? (
              <>
              <ChatMessageList isStreaming={awaitingReply || revealingId !== undefined}>
                {timeline.map((message, index) => {
                  const entry = pendingById.get(message.id);
                  const previous = timeline[index - 1];
                  const isDayStart = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt);
                  const retryPrompt = entry
                    ? (entry.hasFailed ? entry.content : undefined)
                    : (retry?.id === message.id ? retry.prompt : undefined);
                  return (
                    <Fragment key={message.id}>
                      {isDayStart ? (
                        <ChatSystemMessage variant="divider">
                          <Timestamp value={message.createdAt} format="date_weekday" hasTooltip={false} />
                        </ChatSystemMessage>
                      ) : null}
                      <ConversationMessage
                        message={message}
                        status={entry ? (entry.hasFailed ? "error" : "sending") : undefined}
                        isRevealing={message.id === revealingId}
                        onRevealed={completeReveal}
                        onQuote={quote}
                        onEdit={edit}
                        onRetry={retryPrompt === undefined
                          ? undefined
                          : () => resend(retryPrompt, entry?.id)}
                        onDismiss={entry?.hasFailed ? () => dismiss(entry.id) : undefined}
                        onInspect={() => inspect(message.id)}
                        currentMemberId={currentMemberId}
                        memoryHref={conversationId ? `/memory?conversationId=${encodeURIComponent(conversationId)}` : "/memory"}
                      />
                    </Fragment>
                  );
                })}
                {awaitingReply ? (
                  <AssistantMessage>
                    <div className="mission-progress" role="status">
                      <Spinner aria-hidden="true" size="sm" />
                      <span className="thinking-shimmer">
                        {mission?.status === "queued" ? "Queued" : "Mission is running"}
                      </span>
                      <span className="mission-elapsed">
                        {formatDuration(mission?.timing?.acceptedAt
                          ? Math.max(0, now - new Date(mission.timing.acceptedAt).getTime())
                          : undefined)}
                      </span>
                      {mission?.canManage !== false ? <Button
                        label="Stop"
                        variant="ghost"
                        size="sm"
                        isLoading={isStopping}
                        clickAction={() => { if (mission) void stopMission(mission.id); }}
                      /> : null}
                    </div>
                    {missionEvents.filter((event) => event.type === "runner.progress").slice(-1).map((event) => (
                      <Text key={event.id} type="supporting" color="secondary">
                        {typeof event.payload.content === "string" ? event.payload.content : "Runner is working"}
                      </Text>
                    ))}
                    {visibleActivities.length > 0 ? (
                      <div className="mission-activity" aria-label="Mission activity">
                        <div className="mission-activity-heading">
                          <span>Activity</span>
                          <span>{activities.length} {activities.length === 1 ? "tool" : "tools"}</span>
                        </div>
                        {visibleActivities.map((activity) => (
                          <div className="mission-event" data-status={activity.status} key={activity.id}>
                            <span className="mission-event-indicator" aria-hidden="true" />
                            <div className="mission-event-content">
                              <div className="mission-event-summary">
                                <strong>{activity.label}</strong>
                                <span>
                                  {activity.status === "running"
                                    ? "Running"
                                    : activity.status === "failed"
                                      ? "Failed"
                                      : formatDuration(activity.durationMs) ?? "Done"}
                                </span>
                              </div>
                              {activity.preview ? (
                                <details className="mission-event-details">
                                  <summary>Show input</summary>
                                  <code>{activity.preview}</code>
                                </details>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </AssistantMessage>
                ) : null}
              </ChatMessageList>
              {approvals.filter((approval) => approval.missionId === (agentExecution?.missionId ?? mission?.id)).map((approval) => (
                <VStack key={approval.id} padding={4} paddingBlockStart={0}>
                  <MissionApprovalRequest approval={approval} onDecided={refresh}
                    onAskHermes={() => void submit(`Please explain approval request ${approval.id}, including why it is needed, its exact target, effect, and safer alternatives.`)} />
                </VStack>
              ))}
              </>
            ) : null}
          </ConversationSurface>
        </VStack>
        {agentExecution && isAgentOpen && !isCompact ? <aside className={executionStyles.panel}>
          <AgentExecutionPanel key={agentExecution.missionId} execution={agentExecution} presentation="panel"
            onClose={() => setIsAgentOpen(false)} onStop={() => void stopMission(agentExecution.missionId)} isStopping={isStopping} />
        </aside> : null}
        {selected ? <MessageDetailsPanel message={selected} onClose={closeDetails} /> : null}
      </HStack>
      </LayoutContent>} />
      {agentExecution && isCompact ? <BottomSheet isOpen={isAgentOpen} onOpenChange={setIsAgentOpen} label="Mission details" height="tall">
        <AgentExecutionPanel key={agentExecution.missionId} execution={agentExecution} presentation="sheet"
          onClose={() => setIsAgentOpen(false)} onStop={() => void stopMission(agentExecution.missionId)} isStopping={isStopping} />
      </BottomSheet> : null}
    </>
  );
}
