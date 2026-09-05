"use client";

import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { Link } from "@astryxdesign/core/Link";
import { SegmentedControl, SegmentedControlItem } from "@astryxdesign/core/SegmentedControl";
import { pixel, proportional, Table } from "@astryxdesign/core/Table";
import { Heading, Text } from "@astryxdesign/core/Text";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import { formatCost, formatCount, formatElapsed, formatTokens } from "../../../lib/prototype/format";
import { USAGE_GROUPS, USAGE_PERIODS, usageRows, type UsageGroup, type UsagePeriod, type UsageRow } from "../../../lib/prototype/usage";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

interface UsageTableRow extends UsageRow, Record<string, unknown> {
  isTotal: boolean;
}

export function UsageScreen() {
  const { data } = usePrototype();
  const { isMobile, openNavigation } = useShell();
  const [period, setPeriod] = useState<UsagePeriod>("30d");
  const [group, setGroup] = useState<UsageGroup>("mission");
  const { rows, totals } = usageRows(data, { period, group });
  const periodLabel = USAGE_PERIODS.find((entry) => entry.id === period)?.label ?? period;
  const tableRows: UsageTableRow[] = [
    ...rows.map((row) => ({ ...row, isTotal: false })),
    { ...totals, isTotal: true },
  ];

  return (
    <Layout
      height="fill"
      header={(
        <LayoutHeader hasDivider padding={3}>
          <VStack gap={3}>
            <HStack gap={3} vAlign="center">
              {isMobile ? (
                <IconButton
                  label="Back to conversations"
                  tooltip="Conversations"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon="chevronLeft" />}
                  onClick={openNavigation}
                />
              ) : null}
              <Icon icon={ChartBarIcon} color="secondary" />
              <StackItem size="fill">
                <VStack gap={0}>
                  <Heading level={4} accessibilityLevel={1}>Usage and costs</Heading>
                  <Text type="supporting" maxLines={1}>Tokens, time, and estimated cost from mission and Hermes records.</Text>
                </VStack>
              </StackItem>
            </HStack>
            <HStack gap={3} vAlign="center" wrap="wrap">
              <SegmentedControl value={period} onChange={(value) => setPeriod(value as UsagePeriod)} label="Period" size="sm">
                {USAGE_PERIODS.map((entry) => <SegmentedControlItem value={entry.id} label={entry.label} key={entry.id} />)}
              </SegmentedControl>
              <SegmentedControl value={group} onChange={(value) => setGroup(value as UsageGroup)} label="Group by" size="sm">
                {USAGE_GROUPS.map((entry) => <SegmentedControlItem value={entry.id} label={entry.label} key={entry.id} />)}
              </SegmentedControl>
            </HStack>
          </VStack>
        </LayoutHeader>
      )}
      content={(
        <LayoutContent padding={0} label="Usage and costs">
          <VStack gap={3} paddingBlock={3}>
            <HStack paddingInline={4}>
              <Text type="supporting">
                {`Last ${periodLabel}: ${formatCount(totals.missions, "mission")} · ${formatTokens(totals.inputTokens + totals.outputTokens)} tokens · ${formatElapsed(totals.durationMs) ?? "0 s"} of agent time · ${formatCost(totals.costUsd)} estimated. Attribution per connector arrives with the central registry.`}
              </Text>
            </HStack>
            <Table
              data={tableRows}
              idKey="key"
              density="compact"
              hasHover
              textOverflow="truncate"
              columns={[
                {
                  key: "label",
                  header: USAGE_GROUPS.find((entry) => entry.id === group)?.label ?? "Name",
                  width: proportional(3),
                  renderCell: (row) => (
                    <VStack gap={0}>
                      {row.href && !row.isTotal
                        ? <Link href={row.href}>{row.label}</Link>
                        : <Text weight={row.isTotal ? "semibold" : undefined}>{row.label}</Text>}
                      {row.detail ? <Text type="supporting" maxLines={1}>{row.detail}</Text> : null}
                    </VStack>
                  ),
                },
                { key: "missions", header: "Missions", width: pixel(96), align: "end" },
                { key: "inputTokens", header: "Input tokens", width: pixel(120), align: "end", renderCell: (row) => formatTokens(row.inputTokens) },
                { key: "outputTokens", header: "Output tokens", width: pixel(128), align: "end", renderCell: (row) => formatTokens(row.outputTokens) },
                { key: "durationMs", header: "Agent time", width: pixel(120), align: "end", renderCell: (row) => formatElapsed(row.durationMs) ?? "0 s" },
                { key: "costUsd", header: "Cost", width: pixel(96), align: "end", renderCell: (row) => formatCost(row.costUsd) },
              ]}
            />
          </VStack>
        </LayoutContent>
      )}
    />
  );
}
