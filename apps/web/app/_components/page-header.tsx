"use client";

import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, icon, onOpenNavigation, actions }: {
  title: string; subtitle: string; icon: IconType; onOpenNavigation?: () => void; actions?: ReactNode;
}) {
  return (
    <LayoutHeader hasDivider padding={3}>
      <HStack gap={3} vAlign="center">
        {onOpenNavigation ? <IconButton label="Open workspace navigation" tooltip="Navigation" variant="ghost" size="sm"
          icon={<Icon icon="chevronLeft" />} onClick={onOpenNavigation} /> : null}
        <Icon icon={icon} color="secondary" />
        <StackItem size="fill">
          <VStack gap={0}>
            <Heading level={4} accessibilityLevel={1} maxLines={1}>{title}</Heading>
            <Text type="supporting" maxLines={1}>{subtitle}</Text>
          </VStack>
        </StackItem>
        {actions}
      </HStack>
    </LayoutHeader>
  );
}
