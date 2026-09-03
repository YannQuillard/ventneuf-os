"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
} from "@astryxdesign/core/Chat";
import { Markdown } from "@astryxdesign/core/Markdown";
import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

export function HermesConversation({ userInitial }: { userInitial: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [error, setError] = useState<string>();
  const latestUserMessageAt = useRef<number | undefined>(undefined);
  const streamEnd = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/hermes/messages", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load the conversation.");
    const payload = await response.json() as { messages: Message[] };
    setMessages(payload.messages);
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
    streamEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [awaitingReply, messages]);

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
      const payload = await response.json() as { message: Message };
      latestUserMessageAt.current = new Date(payload.message.createdAt).getTime();
      setMessages((current) => current.some(({ id }) => id === payload.message.id)
        ? current
        : [...current, payload.message]);
      setAwaitingReply(true);
      setContent("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Hermes could not accept the message.");
    } finally {
      setSending(false);
    }
  }

  return (
    <ChatLayout
      className="conversation-chat"
      composer={(
        <ChatComposer
          value={content}
          onChange={setContent}
          onSubmit={(value) => void submit(value)}
          placeholder="Message Hermes"
          isDisabled={sending}
          isStopShown={awaitingReply}
          footerActions={(
            <span className={error ? "composer-error" : "composer-status"}>
              {error ?? (awaitingReply ? "Hermes is working…" : "Private conversation")}
            </span>
          )}
          status={error ? { type: "error", message: error } : undefined}
        />
      )}
      emptyState={null}
    >
      <ChatMessageList align="top" density="spacious" isStreaming={awaitingReply}>
        {messages.length === 0 ? (
          <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />} name="Hermes">
            <ChatMessageBubble variant="ghost" width="100%">
              <Markdown contentWidth={720}>The workspace is connected. What would you like me to work on?</Markdown>
            </ChatMessageBubble>
          </ChatMessage>
        ) : messages.map((message) => (
          <ChatMessage
            sender={message.role === "assistant" ? "assistant" : "user"}
            avatar={message.role === "assistant" ? <Avatar name="Hermes" size="md" /> : <Avatar name={userInitial} tooltip="You" size="md" />}
            name={message.role === "assistant" ? "Hermes" : "You"}
            key={message.id}
          >
            <ChatMessageBubble variant={message.role === "assistant" ? "ghost" : "filled"} width={message.role === "assistant" ? "100%" : undefined}>
              <Markdown density="compact" contentWidth={720}>{message.content}</Markdown>
            </ChatMessageBubble>
            <ChatMessageMetadata
              timestamp={new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              footer={(
                <Button
                  label="Copy"
                  size="sm"
                  variant="ghost"
                  onClick={() => void navigator.clipboard.writeText(message.content)}
                />
              )}
            />
          </ChatMessage>
        ))}
        {awaitingReply ? (
          <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />} name="Hermes">
            <ChatMessageBubble variant="ghost">
              <div className="agent-activity" role="status">
                <span className="activity-pulse" aria-hidden="true" />
                <span>Working</span>
              </div>
            </ChatMessageBubble>
          </ChatMessage>
          ) : null}
        <div ref={streamEnd} />
      </ChatMessageList>
    </ChatLayout>
  );
}
