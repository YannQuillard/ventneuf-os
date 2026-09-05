"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutFooter, LayoutHeader, StackItem } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Section } from "@astryxdesign/core/Section";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/24/outline";
import type { NavigationEntry, NavigationGroup } from "../../../lib/prototype/navigation";
import type { Device, Member } from "../../../lib/prototype/types";
import { navigationIcons } from "./navigation-icons";
import { NavigationEndContent } from "./navigation-status";

interface NavigationRowsProps {
  navigation: NavigationGroup[];
  member: Member;
  device: Device;
  onNavigate: (href: string) => void;
  onOpenSearch: () => void;
  onNewConversation: () => void;
}

interface FlatEntry {
  entry: NavigationEntry;
  parentLabel?: string;
}

function flatten(entries: NavigationEntry[], parentLabel?: string): FlatEntry[] {
  return entries.flatMap((entry) => [{ entry, parentLabel }, ...flatten(entry.children, entry.label)]);
}

function descriptionFor({ entry, parentLabel }: FlatEntry): string | undefined {
  if (entry.kind === "thread" && parentLabel) return `Thread in ${parentLabel}`;
  if (entry.kind === "channel") return "Shared channel";
  if (entry.kind === "main") return "Your private conversation";
  if (entry.kind === "temporary") return "Temporary · not written to memory";
  if (entry.kind === "devices") return "Runners, repositories, connectors";
  if (entry.kind === "usage") return "Tokens, time, and cost by mission";
  return undefined;
}

export function NavigationRows({ navigation, member, device, onNavigate, onOpenSearch, onNewConversation }: NavigationRowsProps) {
  return (
    <Layout
      height="fill"
      defaultHasDividers
      header={(
        <LayoutHeader padding={4}>
          <HStack gap={2} vAlign="center">
            <StackItem size="fill">
              <Heading level={1} accessibilityLevel={1}>ventneuf.os</Heading>
            </StackItem>
            <IconButton
              label="New conversation"
              tooltip="New conversation"
              variant="ghost"
              icon={<Icon icon={PlusIcon} />}
              onClick={onNewConversation}
            />
            <IconButton
              label="Search conversations, missions, and knowledge"
              tooltip="Search"
              variant="ghost"
              icon={<Icon icon={MagnifyingGlassIcon} />}
              onClick={onOpenSearch}
            />
          </HStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={0}>
          {navigation.map((group) => (
            <Section padding={0} dividers={["bottom"]} key={group.id}>
              <List
                hasDividers
                header={(
                  <HStack padding={4} paddingBlockEnd={1}>
                    <Heading level={2}>{group.title}</Heading>
                  </HStack>
                )}
              >
                {flatten(group.entries).map((flat) => {
                  const icons = navigationIcons[flat.entry.kind];
                  return (
                    <ListItem
                      key={flat.entry.id}
                      label={flat.entry.label}
                      description={descriptionFor(flat)}
                      startContent={<Icon icon={flat.entry.isSelected ? icons.selectedIcon : icons.icon} color={flat.entry.isSelected ? "accent" : "secondary"} />}
                      endContent={<NavigationEndContent entry={flat.entry} />}
                      isSelected={flat.entry.isSelected}
                      isDisabled={flat.entry.isDisabled}
                      onClick={flat.entry.href ? () => onNavigate(flat.entry.href as string) : undefined}
                    />
                  );
                })}
              </List>
            </Section>
          ))}
        </LayoutContent>
      )}
      footer={(
        <LayoutFooter>
          <HStack gap={3} vAlign="center" padding={3}>
            <Avatar name={member.name} size="sm" />
            <StackItem size="fill">
              <Text type="supporting" color="primary" maxLines={1}>{member.name}</Text>
            </StackItem>
            <StatusDot
              variant={device.isOnline ? "success" : "neutral"}
              label={device.isOnline ? "Runner online" : "Runner offline"}
            />
            <Text type="supporting" maxLines={1}>{device.name}</Text>
          </HStack>
        </LayoutFooter>
      )}
    />
  );
}
