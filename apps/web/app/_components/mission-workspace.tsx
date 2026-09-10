"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Heading, Text } from "@astryxdesign/core/Text";
import { useId, type ReactNode } from "react";
import styles from "./mission-workspace.module.css";

export interface MissionWorkspaceTab { id: string; label: string; endContent?: ReactNode }

/** Shared by the live workspace and the design preview; data and actions stay with their owners. */
export function MissionWorkspaceFrame({ title, subtitle, status, actions, tabs, tab, onTabChange, onClose, presentation, children }: {
  title: string; subtitle?: string; status: ReactNode; actions?: ReactNode;
  tabs: MissionWorkspaceTab[]; tab: string; onTabChange(tab: string): void;
  onClose(): void; presentation: "panel" | "sheet"; children: ReactNode;
}) {
  const id = useId();
  const panelId = (value: string) => `${id}-mission-panel-${value}`;
  return (
    <section className={presentation === "panel" ? styles.panel : styles.sheet} aria-label="Mission details">
      <VStack gap={3} padding={4} paddingBlockEnd={2}>
        <HStack gap={3} vAlign="start">
          <StackItem size="fill">
            <VStack gap={1}>
              {status}
              <Heading level={2} accessibilityLevel={2} maxLines={2}>{title}</Heading>
              {subtitle ? <Text type="supporting">{subtitle}</Text> : null}
            </VStack>
          </StackItem>
          {presentation === "panel" ? <IconButton label="Close the mission panel" tooltip="Close" variant="ghost" size="sm"
            icon={<Icon icon="close" size="sm" />} onClick={onClose} /> : null}
        </HStack>
        {actions ? <HStack gap={2} vAlign="center" wrap="wrap">{actions}</HStack> : null}
      </VStack>
      <HStack paddingInline={2}>
        <TabList value={tab} onChange={onTabChange} size="sm" hasDivider role="tablist" aria-label="Mission views">
          {tabs.map((entry) => <Tab key={entry.id} value={entry.id} label={entry.label} panelId={panelId(entry.id)} endContent={entry.endContent} />)}
        </TabList>
      </HStack>
      <div className={styles.body} role="tabpanel" id={panelId(tab)}>{children}</div>
    </section>
  );
}
