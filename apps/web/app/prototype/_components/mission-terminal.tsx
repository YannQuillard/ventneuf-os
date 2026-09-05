"use client";

import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { githubDark } from "@astryxdesign/core/theme/syntax";
import { isTerminal } from "../../../lib/prototype/state";
import type { Device, Mission } from "../../../lib/prototype/types";

export function MissionTerminal({ mission, device }: { mission: Mission; device?: Device }) {
  const isLive = !isTerminal(mission.status);
  const code = [
    ...mission.terminal.lines.map((line) => line.text),
    ...(isLive ? ["▍"] : []),
  ].join("\n");

  return (
    <VStack gap={3} padding={4}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <StatusDot variant={isLive ? "accent" : "neutral"} label={isLive ? "Live terminal" : "Terminal closed"} isPulsing={isLive} />
        <Text type="supporting" color="primary" weight="medium">{isLive ? "Live" : "Closed"}</Text>
        <Text type="code">{mission.terminal.sessionId}</Text>
        <StackItem size="fill" />
        <Button
          label="Open in Orca"
          size="sm"
          variant="ghost"
          isDisabled
          tooltip={`Opens the owned terminal on ${device?.name ?? "the runner"}`}
        />
      </HStack>
      {mission.worktree ? <Text type="supporting" maxLines={1}>{mission.worktree}</Text> : null}
      <CodeBlock
        code={code}
        language="bash"
        title={`${device?.name ?? "Runner"} · owned terminal`}
        hasLanguageLabel={false}
        syntaxTheme={githubDark}
        width="100%"
        size="sm"
        isWrapped
      />
      <Text type="supporting">
        Output is captured by the runner for this mission only. Private model reasoning is never shown here.
      </Text>
    </VStack>
  );
}
