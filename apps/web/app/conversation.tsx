"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import {
  ChatComposer,
  ChatLayout,
  ChatMessage,
  ChatMessageBubble,
  ChatMessageList,
  ChatMessageMetadata,
  ChatSystemMessage,
} from "@astryxdesign/core/Chat";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { VStack } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  createdAt: string;
}

const chatLayout: CSSProperties = { flex: 1, minHeight: 0 };

function ConversationMessage({ message }: { message: Message }) {
  if (message.role === "system" || message.role === "tool") {
    return (
      <ChatSystemMessage icon={message.role === "tool" ? <Icon icon="wrench" size="sm" /> : undefined}>
        {message.content}
      </ChatSystemMessage>
    );
  }

  if (message.role === "user") {
    return (
      <ChatMessage sender="user">
        <ChatMessageBubble
          metadata={<ChatMessageMetadata timestamp={<Timestamp value={message.createdAt} format="time" />} />}
        >
          {message.content}
        </ChatMessageBubble>
      </ChatMessage>
    );
  }

  return (
    <ChatMessage sender="assistant" avatar={<Avatar name="Hermes" size="md" />}>
      <ChatMessageBubble variant="ghost" width="100%">
        <Markdown contentWidth={840}>{message.content}</Markdown>
      </ChatMessageBubble>
      <ChatMessageMetadata
        timestamp={<Timestamp value={message.createdAt} format="time" />}
        footer={(
          <IconButton
            label="Copy message"
            tooltip="Copy"
            variant="ghost"
            size="sm"
            icon={<Icon icon="copy" size="sm" />}
            onClick={() => void navigator.clipboard.writeText(message.content)}
          />
        )}
      />
    </ChatMessage>
  );
}

export function HermesConversation() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [content, setContent] = useState("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [awaitingReply, setAwaitingReply] = useState(false);
  const [error, setError] = useState<string>();
  const latestUserMessageAt = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/hermes/messages", { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load the conversation.");
    const payload = await response.json() as { messages: Message[] };
    setMessages(payload.messages);
    setIsLoaded(true);
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
                  <span className="thinking-shimmer" role="status">Thinking…</span>
                </ChatMessageBubble>
              </ChatMessage>
            ) : null}
          </ChatMessageList>
        ) : null}
      </ChatLayout>
    </VStack>
  );
}
