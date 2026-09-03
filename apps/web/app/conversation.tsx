"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    const message = content.trim();
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
    <>
      <div className="message-stream" aria-live="polite">
        <div className="day-divider"><span>Today</span></div>
        {messages.length === 0 ? (
          <article className="message hermes-message">
            <div className="message-avatar">H</div>
            <div>
              <div className="message-meta"><strong>Hermes</strong><span>Control plane</span></div>
              <p>The workspace is connected. What would you like me to work on?</p>
            </div>
          </article>
        ) : messages.map((message) => (
          <article className={`message ${message.role}-message`} key={message.id}>
            <div className="message-avatar">{message.role === "assistant" ? "H" : userInitial}</div>
            <div>
              <div className="message-meta">
                <strong>{message.role === "assistant" ? "Hermes" : "You"}</strong>
                <span>{new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
              <p>{message.content}</p>
            </div>
          </article>
        ))}
        {awaitingReply ? (
          <article className="message hermes-message pending-message" aria-label="Hermes is working">
            <div className="message-avatar">H</div>
            <div>
              <div className="message-meta"><strong>Hermes</strong><span>Working</span></div>
              <div className="typing-indicator" aria-hidden="true"><span /><span /><span /></div>
            </div>
          </article>
        ) : null}
        <div ref={streamEnd} />
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <textarea
            aria-label="Message Hermes"
            placeholder="Ask Hermes to investigate, plan, or launch a mission…"
            rows={2}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className="composer-footer">
            <span className={error ? "composer-error" : undefined}>
              {error ?? (awaitingReply ? "Hermes is working on your request…" : "Messages are queued securely through the control plane.")}
            </span>
            <button type="submit" disabled={!content.trim() || sending}>{sending ? "Sending…" : "Send"}</button>
          </div>
        </form>
      </div>
    </>
  );
}
