"use client";

import { ChatComposer, ChatLayout, ChatMessageList, ChatSystemMessage } from "@astryxdesign/core/Chat";
import { Icon } from "@astryxdesign/core/Icon";
import { VStack } from "@astryxdesign/core/Layout";
import type { CSSProperties } from "react";
import type { FixtureConversation } from "../lib/fixtures";
import { ConversationMessage } from "./conversation-message";

const chatLayout: CSSProperties = { flex: 1, minHeight: 0 };

function ignore() {}

export function FixtureConversationView({ conversation }: { conversation: FixtureConversation }) {
  return (
    <VStack height="100%">
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
            <ConversationMessage message={message} key={message.id} />
          ))}
        </ChatMessageList>
      </ChatLayout>
    </VStack>
  );
}
