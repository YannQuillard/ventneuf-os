"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
} from "@astryxdesign/core/Chat";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { VStack } from "@astryxdesign/core/Layout";
import { Spinner } from "@astryxdesign/core/Spinner";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { formatDuration, type Message, type MissionState, type MissionTiming } from "../lib/conversations";
import { ConversationMessage } from "./conversation-message";

const chatLayout: CSSProperties = { flex: 1, minHeight: 0 };

export function HermesConversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [mission, setMission] = useState<MissionState | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [error, setError] = useState<string>();
  const latestUserMessageAt = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/hermes/messages", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load the conversation.");
    const payload = await response.json() as { messages: Message[]; mission: MissionState | null };
    setMessages(payload.messages);
    setMission(payload.mission);
    setIsLoaded(true);
    const active = payload.mission?.status === "queued" || payload.mission?.status === "running";
    setAwaitingReply(active);
    if (payload.mission?.status === "failed") {
      setError(payload.mission.failure ?? "Hermes could not complete the request.");
    }
    const lastMessage = payload.messages.at(-1);
    if (
      latestUserMessageAt.current
      && lastMessage?.role === "assistant"
      && new Date(lastMessage.createdAt).getTime() >= latestUserMessageAt.current
    ) {
      setAwaitingReply(false);
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

  async function submit(value: string) {
    const message = value.trim();
    if (!message || sending) return;
    setSending(true);
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
      latestUserMessageAt.current = new Date(payload.message.createdAt).getTime();
      setMessages((current) => current.some(({ id }) => id === payload.message.id)
        ? current
        : [...current, payload.message]);
      setAwaitingReply(true);
      setMission({ id: payload.missionId, status: payload.status, timing: payload.timing });
      setNow(Date.now());
      setContent("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hermes could not accept the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <VStack height="100%">
      <ChatLayout
        style={chatLayout}
        composer={(
          <ChatComposer
            value={content}
            onChange={setContent}
            onSubmit={(value) => void submit(value)}
            placeholder="Message Hermes"
            isDisabled={sending}
            status={error ? { type: "error", message: error } : undefined}
          />
        )}
        emptyState={isLoaded ? (
          <EmptyState
            title="Ask Hermes anything"
            description="This conversation is private to you. Send a message to get started."
          />
        ) : (
          <Spinner aria-label="Loading the conversation" />
        )}
      >
        {messages.length > 0 || awaitingReply ? (
          <ChatMessageList isStreaming={awaitingReply}>
            {messages.map((message) => <ConversationMessage message={message} key={message.id} />)}
            {awaitingReply ? (
              <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />}>
                <ChatMessageBubble variant="ghost">
                  <div className="mission-progress" role="status">
                    <Spinner aria-hidden="true" size="sm" />
                    <span className="thinking-shimmer">
                      {mission?.status === "queued" ? "Queued" : "Hermes is working"}
                    </span>
                    <span className="mission-elapsed">
                      {formatDuration(mission?.timing.acceptedAt
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
  );
}
