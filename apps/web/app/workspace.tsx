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
import { Heading, Text } from "@astryxdesign/core/Text";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import {
  ChatBubbleLeftRightIcon,
  HashtagIcon,
  MagnifyingGlassIcon,
} from "@heroicons/react/24/outline";
import { ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon } from "@heroicons/react/24/solid";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { RunnerSetup } from "./runner-setup";

const projectChannels = ["ventneuf-os", "ampel", "brandstamp"];

const commands = [
  { id: "/", label: "Hermes", auxiliaryData: { group: "Navigate" } },
  ...projectChannels.map((channel) => ({
    id: `#${channel}`,
    label: channel,
    auxiliaryData: { group: "Navigate" },
  })),
  { id: "sign-out", label: "Sign out", auxiliaryData: { group: "Account" } },
];

function signOut() {
  window.location.assign("/auth/logout");
}

export function Workspace({ email, children }: { email: string; children: ReactNode }) {
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
                <RunnerSetup />
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
                isSelected
              />
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
                <Avatar name="Hermes" size="md" tooltip={false} />
                <VStack gap={0.5}>
                  <Heading level={4} accessibilityLevel={1}>Hermes</Heading>
                  <Text type="supporting" color="secondary">Cloud agent</Text>
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
