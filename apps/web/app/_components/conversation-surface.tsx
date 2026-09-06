"use client";

import { ChatComposer, ChatComposerInput, ChatLayout, type ChatComposerInputHandle } from "@astryxdesign/core/Chat";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode, RefObject } from "react";
import styles from "./conversation-surface.module.css";

export function ConversationSurface({ value, onChange, onSubmit, inputRef, placeholder = "Message Hermes", scope = "Personal knowledge",
  error, emptyState, headerActions, children }: {
  value: string; onChange(value: string): void; onSubmit(value: string): void;
  inputRef: RefObject<ChatComposerInputHandle | null>; placeholder?: string; scope?: string;
  error?: string; emptyState?: ReactNode; headerActions?: ReactNode; children: ReactNode;
}) {
  return <ChatLayout className={styles.surface} emptyState={emptyState} composer={
    <ChatComposer value={value} onChange={onChange} onSubmit={onSubmit} placeholder={placeholder}
      status={error ? { type: "error", message: error } : undefined} headerActions={headerActions}
      footerActions={<Text type="supporting">{scope}</Text>} input={<ChatComposerInput handleRef={inputRef} />} />
  }>{children}</ChatLayout>;
}
