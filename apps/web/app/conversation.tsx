"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import {
  ChatComposer,
  ChatComposerInput,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatSystemMessage,
  type ChatComposerInputHandle,
} from "@astryxdesign/core/Chat";
import { ClickableCard } from "@astryxdesign/core/ClickableCard";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDuration, type Message, type MissionState, type MissionTiming } from "../lib/conversations";
import { ConversationMessage } from "./conversation-message";
import { MessageDetailsPanel } from "./message-details";

const chatColumn: CSSProperties = { flex: 1, minWidth: 0, height: "100%" };
const chatLayout: CSSProperties = { flex: 1, minHeight: 0 };

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

function lastAssistantRetry(messages: Message[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role !== "assistant") continue;
    for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
      if (messages[earlier].role === "user") {
        return { id: messages[index].id, prompt: messages[earlier].content };
      }
    }
    return undefined;
  }
  return undefined;
}

export function HermesConversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [content, setContent] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [revealingId, setRevealingId] = useState<string>();
  const [mission, setMission] = useState<MissionState | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const latestUserMessageAt = useRef<number | undefined>(undefined);
  const composerInput = useRef<ChatComposerInputHandle>(null);
  const acceptedMessages = useRef<Message[]>([]);
  const pendingCount = useRef(0);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/hermes/messages", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load the conversation.");
    const payload = await response.json() as { messages: Message[]; mission: MissionState | null };
    const knownIds = new Set(payload.messages.map(({ id }) => id));
    acceptedMessages.current = acceptedMessages.current.filter(({ id }) => !knownIds.has(id));
    setMessages(acceptedMessages.current.length > 0
      ? [...payload.messages, ...acceptedMessages.current]
      : payload.messages);
    setMission(payload.mission ?? null);
    setIsLoaded(true);
    if (payload.mission) {
      setAwaitingReply(payload.mission.status === "queued" || payload.mission.status === "running");
      if (payload.mission.status === "failed") {
        setError(payload.mission.failure ?? "Hermes could not complete the request.");
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
  }, []);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        await refresh();
      } catch (reason) {
        if (!stopped) setError(reason instanceof Error ? reason.message : "Unable to load the conversation.");
      }
      if (!stopped) timer = window.setTimeout(poll, awaitingReply ? 750 : 5_000);
    };
    void poll();
    return () => {
      stopped = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [awaitingReply, refresh]);

  useEffect(() => {
    if (!awaitingReply) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [awaitingReply]);

  const submit = useCallback(async (value: string) => {
    const message = value.trim();
    if (!message) return;
    pendingCount.current += 1;
    const pendingId = `pending-${pendingCount.current}`;
    setPending((current) => [
      ...current,
      { id: pendingId, content: message, createdAt: new Date().toISOString(), hasFailed: false },
    ]);
    setError(undefined);
    try {
      const response = await fetch("/api/hermes/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
      if (!response.ok) throw new Error("Hermes could not accept the message.");
      const payload = await response.json() as {
        message: Message;
        missionId: string;
        status: MissionState["status"];
        timing: MissionTiming;
      };
      acceptedMessages.current = [...acceptedMessages.current, payload.message];
      latestUserMessageAt.current = new Date(payload.message.createdAt).getTime();
      setMessages((current) => current.some(({ id }) => id === payload.message.id)
        ? current
        : [...current, payload.message]);
      setPending((current) => current.filter(({ id }) => id !== pendingId));
      setAwaitingReply(true);
      setMission(payload.missionId
        ? { id: payload.missionId, status: payload.status, timing: payload.timing }
        : null);
      setNow(Date.now());
    } catch {
      setPending((current) => current.map((entry) => entry.id === pendingId
        ? { ...entry, hasFailed: true }
        : entry));
    }
  }, []);

  const resend = useCallback((prompt: string, pendingId?: string) => {
    if (pendingId) setPending((current) => current.filter(({ id }) => id !== pendingId));
    void submit(prompt);
  }, [submit]);

  const dismiss = useCallback((pendingId: string) => {
    setPending((current) => current.filter(({ id }) => id !== pendingId));
  }, []);

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
      })),
    ]
    : messages;
  const pendingById = new Map(pending.map((entry) => [entry.id, entry]));
  const retry = lastAssistantRetry(messages);
  const selected = selectedMessageId === undefined
    ? undefined
    : timeline.find(({ id }) => id === selectedMessageId);

  useEffect(() => {
    if (selectedMessageId !== undefined && selected === undefined) setSelectedMessageId(undefined);
  }, [selected, selectedMessageId]);

  return (
    <VStack height="100%" className="conversation-surface">
      <HStack height="100%">
        <VStack style={chatColumn}>
          <ChatLayout
            style={chatLayout}
            composer={(
              <ChatComposer
                value={content}
                onChange={setContent}
                onSubmit={(value) => {
                  setContent("");
                  void submit(value);
                }}
                placeholder="Message Hermes"
                status={error ? { type: "error", message: error } : undefined}
                input={<ChatComposerInput handleRef={composerInput} />}
              />
            )}
            emptyState={isLoaded ? (
              <VStack gap={6} hAlign="center" width="100%" maxWidth={560} padding={4}>
                <EmptyState
                  title="Ask Hermes anything"
                  description="This conversation is private to you. Send a message to get started."
                />
                <Grid columns={{ minWidth: 200, max: 2 }} gap={3} width="100%">
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
                </Grid>
              </VStack>
            ) : (
              <Spinner aria-label="Loading the conversation" />
            )}
          >
            {timeline.length > 0 || awaitingReply ? (
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
                      />
                    </Fragment>
                  );
                })}
                {awaitingReply ? (
                  <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />}>
                    <ChatMessageBubble variant="ghost">
                      <div className="mission-progress" role="status">
                        <Spinner aria-hidden="true" size="sm" />
                        <span className="thinking-shimmer">
                          {mission?.status === "queued" ? "Queued" : "Hermes is working"}
                        </span>
                        <span className="mission-elapsed">
                          {formatDuration(mission?.timing?.acceptedAt
                            ? Math.max(0, now - new Date(mission.timing.acceptedAt).getTime())
                            : undefined)}
                        </span>
                      </div>
                    </ChatMessageBubble>
                  </ChatMessage>
                ) : null}
              </ChatMessageList>
            ) : null}
          </ChatLayout>
        </VStack>
        {selected ? <MessageDetailsPanel message={selected} onClose={closeDetails} /> : null}
      </HStack>
    </VStack>
  );
}
