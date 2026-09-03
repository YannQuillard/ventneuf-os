"use client";

import { ChatComposer, ChatLayout, ChatMessageList, ChatSystemMessage } from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { useCallback, useState, type CSSProperties } from "react";
import type { FixtureConversation } from "../lib/fixtures";
import { ConversationMessage } from "./conversation-message";
import { MessageDetailsPanel } from "./message-details";

const chatColumn: CSSProperties = { flex: 1, minWidth: 0, height: "100%" };
const chatLayout: CSSProperties = { flex: 1, minHeight: 0 };

function ignore() {}

export function FixtureConversationView({ conversation }: { conversation: FixtureConversation }) {
  const [selectedMessageId, setSelectedMessageId] = useState<string>();

  const inspect = useCallback((id: string) => {
    setSelectedMessageId((current) => current === id ? undefined : id);
  }, []);

  const closeDetails = useCallback(() => setSelectedMessageId(undefined), []);

  const selected = conversation.messages.find(({ id }) => id === selectedMessageId);

  return (
    <VStack height="100%" className="conversation-surface">
      <HStack height="100%">
        <VStack style={chatColumn}>
          <ChatLayout
            style={chatLayout}
            composer={(
              <ChatComposer
                value=""
                onChange={ignore}
                onSubmit={ignore}
                placeholder="Sample conversation — read only"
                isDisabled
              />
            )}
          >
            <ChatMessageList align="top">
              <ChatSystemMessage>Sample conversation — representative fixture data</ChatSystemMessage>
              {conversation.kind === "temporary" ? (
                <ChatSystemMessage icon={<Icon icon="clock" size="sm" />}>
                  Temporary conversation — excluded from durable memory
                </ChatSystemMessage>
              ) : null}
              {conversation.messages.map((message) => (
                <ConversationMessage
                  message={message}
                  onInspect={() => inspect(message.id)}
                  key={message.id}
                />
              ))}
            </ChatMessageList>
          </ChatLayout>
        </VStack>
        {selected ? <MessageDetailsPanel message={selected} onClose={closeDetails} /> : null}
      </HStack>
    </VStack>
  );
}
