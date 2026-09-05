"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Divider } from "@astryxdesign/core/Divider";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { Text } from "@astryxdesign/core/Text";
import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/24/outline";
import type { NavigationEntry, NavigationGroup } from "../../../lib/prototype/navigation";
import type { Member } from "../../../lib/prototype/types";
import { navigationIcons } from "./navigation-icons";
import { NavigationEndContent } from "./navigation-status";

interface WorkspaceSideNavProps {
  navigation: NavigationGroup[];
  member: Member;
  onOpenSearch: () => void;
  onNewConversation: () => void;
}

function NavigationItem({ entry }: { entry: NavigationEntry }) {
  const icons = navigationIcons[entry.kind];
  return (
    <SideNavItem
      label={entry.label}
      href={entry.href}
      icon={icons.icon}
      selectedIcon={icons.selectedIcon}
      isSelected={entry.isSelected}
      isDisabled={entry.isDisabled}
      endContent={<NavigationEndContent entry={entry} />}
      size="sm"
    >
      {entry.children.length > 0 ? entry.children.map((child) => <NavigationItem entry={child} key={child.id} />) : undefined}
    </SideNavItem>
  );
}

export function WorkspaceSideNav({ navigation, member, onOpenSearch, onNewConversation }: WorkspaceSideNavProps) {
  const workspace = navigation.find((group) => group.id === "workspace");

  return (
    <SideNav
      header={<SideNavHeading heading="ventneuf.os" />}
      topContent={(
        <SideNavItem
          label="Search"
          icon={MagnifyingGlassIcon}
          endContent={<Kbd keys="mod+p" />}
          onClick={onOpenSearch}
          size="sm"
        />
      )}
      footer={(
        <VStack gap={0}>
          {workspace ? (
            <VStack gap={0} paddingBlock={1}>
              {workspace.entries.map((entry) => <NavigationItem entry={entry} key={entry.id} />)}
            </VStack>
          ) : null}
          <Divider />
          <HStack gap={2} vAlign="center" padding={3}>
            <Avatar name={member.name} size="sm" />
            <StackItem size="fill">
              <Text type="supporting" color="primary" maxLines={1}>{member.name}</Text>
            </StackItem>
          </HStack>
        </VStack>
      )}
    >
      {navigation.filter((group) => group.id !== "workspace").map((group) => (
        <SideNavSection
          title={group.title}
          key={group.id}
          endContent={group.id === "personal" ? (
            <IconButton
              label="New conversation"
              tooltip="New conversation"
              variant="ghost"
              size="sm"
              icon={<Icon icon={PlusIcon} size="sm" />}
              onClick={onNewConversation}
            />
          ) : undefined}
        >
          {group.entries.map((entry) => <NavigationItem entry={entry} key={entry.id} />)}
        </SideNavSection>
      ))}
    </SideNav>
  );
}
