"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Icon } from "@astryxdesign/core/Icon";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { Text } from "@astryxdesign/core/Text";
import { Token } from "@astryxdesign/core/Token";
import { useState } from "react";
import { tokenizeDiff } from "../../../lib/prototype/diff";
import { formatCount, formatDiffStats } from "../../../lib/prototype/format";
import { fileStatusPresentation } from "../../../lib/prototype/presentation";
import type { Mission } from "../../../lib/prototype/types";

export function MissionChanges({ mission }: { mission: Mission }) {
  const [selectedPath, setSelectedPath] = useState(mission.files[0]?.path);
  const selected = mission.files.find((file) => file.path === selectedPath) ?? mission.files[0];

  if (mission.files.length === 0) {
    return (
      <EmptyState
        title="No changes"
        description={mission.branch
          ? "The agent has not edited any file yet."
          : "This mission is read-only. It reviewed a snapshot without editing files."}
        isCompact
      />
    );
  }

  const additions = mission.files.reduce((total, file) => total + file.additions, 0);
  const deletions = mission.files.reduce((total, file) => total + file.deletions, 0);

  return (
    <VStack gap={0}>
      <VStack gap={2} padding={4} paddingBlockEnd={2}>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text type="code">{mission.branch}</Text>
          <Icon icon="chevronRight" size="sm" color="secondary" />
          <Text type="code">{mission.baseBranch}</Text>
          <StackItem size="fill" />
          <Text type="supporting" hasTabularNumbers>
            {`${formatDiffStats(additions, deletions)} · ${formatCount(mission.files.length, "file")}`}
          </Text>
        </HStack>
        {mission.pullRequest ? (
          <HStack>
            <Button
              label={`Pull request #${mission.pullRequest.number} · ${mission.pullRequest.state}`}
              size="sm"
              variant="secondary"
              href={mission.pullRequest.url}
              target="_blank"
            />
          </HStack>
        ) : (
          <Text type="supporting">Branch not pushed yet. The pull request opens after verification.</Text>
        )}
      </VStack>
      <List density="compact" hasDividers>
        {mission.files.map((file) => {
          const presentation = fileStatusPresentation[file.status];
          return (
            <ListItem
              key={file.path}
              label={<Text type="code" maxLines={1}>{file.path}</Text>}
              startContent={<Token label={presentation.short} description={presentation.label} color={presentation.color} size="sm" />}
              endContent={<Text type="supporting" hasTabularNumbers>{formatDiffStats(file.additions, file.deletions)}</Text>}
              onClick={() => setSelectedPath(file.path)}
              isSelected={selected?.path === file.path}
            />
          );
        })}
      </List>
      {selected ? (
        <VStack padding={4}>
          <CodeBlock
            code={selected.diff}
            language="diff"
            tokenizer={tokenizeDiff}
            title={selected.path}
            hasLanguageLabel={false}
            size="sm"
            width="100%"
            isWrapped
          />
        </VStack>
      ) : null}
    </VStack>
  );
}
