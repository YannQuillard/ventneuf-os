"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar, AvatarStatusDot } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { HStack, Layout, LayoutContent, LayoutHeader, VStack } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ChatBubbleLeftRightIcon, HashtagIcon } from "@heroicons/react/24/outline";
import { ChatBubbleLeftRightIcon as ChatBubbleLeftRightSolidIcon } from "@heroicons/react/24/solid";
import { VentneufMark } from "./brand";
import { HermesConversation } from "./conversation";

const projectChannels = ["ventneuf-os", "ampel", "brandstamp"];

export function Workspace({ email }: { email: string }) {
  return (
    <AppShell
      contentPadding={0}
      sideNav={(
        <SideNav
          header={(
            <SideNavHeading
              icon={<VentneufMark />}
              heading="ventneuf.os"
              headerEndContent={(
                <StatusDot variant="success" label="Control plane online" tooltip="Control plane online" />
              )}
            />
          )}
          footer={(
            <HStack gap={2} vAlign="center" padding={3}>
              <StatusDot variant="neutral" label="Runner setup pending" />
              <VStack gap={0}>
                <Text type="label" weight="semibold">This Mac</Text>
                <Text type="supporting" color="secondary">Runner setup pending</Text>
              </VStack>
            </HStack>
          )}
        >
          <SideNavSection title="Private">
            <SideNavItem
              label="Hermes"
              href="#hermes"
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
          <LayoutHeader hasDivider>
            <HStack hAlign="between" vAlign="center" width="100%">
              <HStack gap={3} vAlign="center">
                <Avatar
                  name="Hermes"
                  size="md"
                  status={<AvatarStatusDot variant="success" label="Online" />}
                  tooltip={false}
                />
                <VStack gap={0}>
                  <Heading level={4} accessibilityLevel={1}>Hermes</Heading>
                  <Text type="supporting" color="secondary">Cloud agent online</Text>
                </VStack>
              </HStack>
              <HStack gap={3} vAlign="center">
                <Text type="supporting" color="secondary">{email}</Text>
                <Button label="Sign out" variant="ghost" size="sm" href="/auth/logout" />
              </HStack>
            </HStack>
          </LayoutHeader>
        )}
        content={(
          <LayoutContent padding={0}>
            <HermesConversation />
          </LayoutContent>
        )}
      />
    </AppShell>
  );
}
