"use client";

import { Blockquote } from "@astryxdesign/core/Blockquote";
import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, Layout, LayoutContent, LayoutFooter, VStack } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useState } from "react";
import { suggestedThreadTitle } from "../../../lib/prototype/state";

interface NewConversationDialogProps {
  isOpen: boolean;
  initialIsTemporary: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreate: (title: string, isTemporary: boolean) => void;
}

export function NewConversationDialog({ isOpen, initialIsTemporary, onOpenChange, onCreate }: NewConversationDialogProps) {
  const [title, setTitle] = useState("");
  const [isTemporary, setTemporary] = useState(initialIsTemporary);

  useEffect(() => {
    if (!isOpen) return;
    setTitle("");
    setTemporary(initialIsTemporary);
  }, [initialIsTemporary, isOpen]);

  const create = () => {
    onCreate(title, isTemporary);
    onOpenChange(false);
  };

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={460}>
      <Layout
        height="auto"
        defaultHasDividers
        header={<DialogHeader title="New conversation" subtitle="A private conversation with Hermes" onOpenChange={onOpenChange} />}
        content={(
          <LayoutContent padding={4}>
            <FormLayout defaultOptionality="optional">
              <TextInput
                label="Title"
                value={title}
                onChange={setTitle}
                placeholder="What is this conversation about?"
                hasAutoFocus
                onEnter={create}
                isOptional
              />
              <Switch
                label="Temporary"
                description="Discarded after 24 hours. Nothing is written to durable knowledge."
                value={isTemporary}
                onChange={setTemporary}
              />
            </FormLayout>
          </LayoutContent>
        )}
        footer={(
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
              <Button label={isTemporary ? "Start temporary conversation" : "Create conversation"} variant="primary" onClick={create} />
            </HStack>
          </LayoutFooter>
        )}
      />
    </Dialog>
  );
}

export interface ThreadSource {
  messageId: string;
  content: string;
  authorName: string;
  conversationLabel: string;
}

interface StartThreadDialogProps {
  source?: ThreadSource;
  onOpenChange: (isOpen: boolean) => void;
  onCreate: (title: string) => void;
}

export function StartThreadDialog({ source, onOpenChange, onCreate }: StartThreadDialogProps) {
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (source) setTitle(suggestedThreadTitle(source.content));
  }, [source]);

  const create = () => {
    onCreate(title);
    onOpenChange(false);
  };

  return (
    <Dialog isOpen={Boolean(source)} onOpenChange={onOpenChange} purpose="form" width={520}>
      <Layout
        height="auto"
        defaultHasDividers
        header={<DialogHeader title="Start a thread" subtitle={source ? `From a message in ${source.conversationLabel}` : undefined} onOpenChange={onOpenChange} />}
        content={(
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <TextInput label="Thread title" value={title} onChange={setTitle} hasAutoFocus onEnter={create} />
              {source ? (
                <Blockquote cite={source.authorName === source.conversationLabel ? source.authorName : `${source.authorName} · ${source.conversationLabel}`}>
                  <Markdown density="compact" contentWidth={440} headingLevelStart={4}>{source.content}</Markdown>
                </Blockquote>
              ) : null}
              <Text type="supporting">
                The thread inherits this message as a bounded snapshot and then evolves independently. It keeps the parent readable.
              </Text>
            </VStack>
          </LayoutContent>
        )}
        footer={(
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
              <Button label="Start thread" variant="primary" onClick={create} />
            </HStack>
          </LayoutFooter>
        )}
      />
    </Dialog>
  );
}
