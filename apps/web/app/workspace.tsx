"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { Divider } from "@astryxdesign/core/Divider";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, Layout, LayoutContent, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import {
  ChatBubbleLeftIcon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  HashtagIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import {
  ChatBubbleLeftIcon as ChatBubbleLeftSolidIcon,
  ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon,
  ClockIcon as ClockSolidIcon,
} from "@heroicons/react/24/solid";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { findFixtureConversation, fixtureConversations } from "../lib/fixtures";

const projectChannels = ["ventneuf-os", "ampel", "brandstamp"];

const commands = [
  { id: "/", label: "Hermes", auxiliaryData: { group: "Conversations" } },
  ...fixtureConversations.map((conversation) => ({
    id: `/c/${conversation.id}`,
    label: conversation.kind === "temporary"
      ? `${conversation.title} (temporary)`
      : conversation.title,
    auxiliaryData: { group: "Conversations" },
  })),
  ...projectChannels.map((channel) => ({
    id: `#${channel}`,
    label: channel,
    auxiliaryData: { group: "Projects" },
  })),
  { id: "sign-out", label: "Sign out", auxiliaryData: { group: "Account" } },
];

function signOut() {
  window.location.assign("/auth/logout");
}

function identity(activeConversationId: string) {
  const conversation = findFixtureConversation(activeConversationId);

  if (!conversation) {
    return { name: "Hermes", description: "Cloud agent" };
  }

  return {
    name: conversation.title,
    description: conversation.kind === "temporary"
      ? "Temporary conversation"
      : "Personal conversation",
  };
}

export function Workspace({
  email,
  activeConversationId,
  children,
}: {
  email: string;
  activeConversationId: string;
  children: ReactNode;
}) {
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const searchSource = useMemo(() => createStaticSource(commands), []);
  const router = useRouter();

  useHotkeys([
    { keys: "mod+p", onPress: () => setIsPaletteOpen(true), allowInInputs: true },
  ]);

  const runCommand = (id: string) => {
    setIsPaletteOpen(false);
    if (id === "sign-out") {
      signOut();
      return;
    }
    router.push(id);
  };

  const active = identity(activeConversationId);

  return (
    <>
      <AppShell
        contentPadding={0}
        sideNav={(
          <SideNav
            header={<SideNavHeading heading="ventneuf.os" />}
            topContent={(
              <SideNavItem
                label="Search"
                icon={MagnifyingGlassIcon}
                endContent={<Kbd keys="mod+p" />}
                onClick={() => setIsPaletteOpen(true)}
              />
            )}
            footer={(
              <VStack gap={0}>
                <HStack gap={2} vAlign="center" padding={3}>
                  <StatusDot variant="neutral" label="Runner setup pending" />
                  <VStack gap={0}>
                    <Text type="label" weight="semibold">This Mac</Text>
                    <Text type="supporting" color="secondary">Runner setup pending</Text>
                  </VStack>
                </HStack>
                <Divider />
                <HStack gap={2} vAlign="center" padding={3}>
                  <Avatar name={email} size="sm" />
                  <StackItem size="fill">
                    <Text type="supporting" color="secondary" maxLines={1}>{email}</Text>
                  </StackItem>
                  <MoreMenu
                    label="Account options"
                    size="sm"
                    placement="above"
                    items={[{ label: "Sign out", onClick: signOut }]}
                  />
                </HStack>
              </VStack>
            )}
          >
            <SideNavSection title="Private">
              <SideNavItem
                label="Hermes"
                href="/"
                icon={ChatBubbleLeftRightIcon}
                selectedIcon={ChatBubbleLeftRightSolidIcon}
                isSelected={activeConversationId === "hermes"}
              />
            </SideNavSection>
            <SideNavSection title="Recent">
              {fixtureConversations.map((conversation) => {
                const isTemporary = conversation.kind === "temporary";
                return (
                  <SideNavItem
                    label={conversation.title}
                    href={`/c/${conversation.id}`}
                    icon={isTemporary ? ClockIcon : ChatBubbleLeftIcon}
                    selectedIcon={isTemporary ? ClockSolidIcon : ChatBubbleLeftSolidIcon}
                    isSelected={activeConversationId === conversation.id}
                    endContent={isTemporary ? <Token label="Temporary" size="sm" color="gray" /> : undefined}
                    key={conversation.id}
                  />
                );
              })}
            </SideNavSection>
            <SideNavSection title="Projects">
              {projectChannels.map((channel) => (
                <SideNavItem label={channel} href={`#${channel}`} icon={HashtagIcon} key={channel} />
              ))}
            </SideNavSection>
          </SideNav>
        )}
      >
        <Layout
          height="fill"
          header={(
            <LayoutHeader hasDivider padding={4}>
              <HStack gap={3} vAlign="center">
                <Avatar name={active.name} size="md" tooltip={false} />
                <VStack gap={0.5}>
                  <Heading level={4} accessibilityLevel={1}>{active.name}</Heading>
                  <Text type="supporting" color="secondary">{active.description}</Text>
                </VStack>
              </HStack>
            </LayoutHeader>
          )}
          content={(
            <LayoutContent padding={0}>
              {children}
            </LayoutContent>
          )}
        />
      </AppShell>
      <CommandPalette
        isOpen={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        searchSource={searchSource}
        label="Search and actions"
        onValueChange={runCommand}
      />
    </>
  );
}
