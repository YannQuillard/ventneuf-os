"use client";

import { Avatar } from "@astryxdesign/core/Avatar";
import { Kbd } from "@astryxdesign/core/Kbd";
import { HStack, StackItem } from "@astryxdesign/core/Layout";
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from "@astryxdesign/core/SideNav";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import type { NavigationEntry, NavigationGroup } from "../../../lib/prototype/navigation";
import type { Device, Member } from "../../../lib/prototype/types";
import { navigationIcons } from "./navigation-icons";
import { NavigationEndContent } from "./navigation-status";

interface WorkspaceSideNavProps {
  navigation: NavigationGroup[];
  member: Member;
  device: Device;
  onOpenSearch: () => void;
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

export function WorkspaceSideNav({ navigation, member, device, onOpenSearch }: WorkspaceSideNavProps) {
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
        <HStack gap={2} vAlign="center" padding={3}>
          <Avatar name={member.name} size="sm" />
          <StackItem size="fill">
            <Text type="supporting" color="primary" maxLines={1}>{member.name}</Text>
          </StackItem>
          <StatusDot
            variant={device.isOnline ? "success" : "neutral"}
            label={device.isOnline ? "Runner online" : "Runner offline"}
            tooltip={device.isOnline ? "Runner online" : "Runner offline"}
          />
          <Text type="supporting" maxLines={1}>{device.name}</Text>
        </HStack>
      )}
    >
      {navigation.map((group) => (
        <SideNavSection title={group.title} key={group.id}>
          {group.entries.map((entry) => <NavigationItem entry={entry} key={entry.id} />)}
        </SideNavSection>
      ))}
    </SideNav>
  );
}
