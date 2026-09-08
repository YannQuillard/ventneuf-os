"use client";

import { HStack } from "@astryxdesign/core/Layout";
import { StatusDot, type StatusDotVariant } from "@astryxdesign/core/StatusDot";
import type { NavigationEntry } from "../../lib/workspace-navigation";

// A trailing icon button carries its own inset, so its ink never reaches the edge of the row.
// The dot has none of its own, and reads as cramped without the same breathing room.
function NavigationDot({ variant, label, tooltip, isPulsing }: {
  variant: StatusDotVariant; label: string; tooltip: string; isPulsing?: boolean;
}) {
  return <HStack paddingInlineEnd={1.5} vAlign="center">
    <StatusDot variant={variant} label={label} tooltip={tooltip} isPulsing={isPulsing} />
  </HStack>;
}

export function NavigationEndContent({ entry }: { entry: NavigationEntry }) {
  if (entry.kind === "devices") {
    return entry.status
      ? <NavigationDot variant="success" label="A runner is online" tooltip="Runner online" />
      : <NavigationDot variant="neutral" label="No runner online" tooltip="No runner online" />;
  }
  if (entry.status === "attention") {
    return <NavigationDot variant="warning" label="An approval needs your decision" tooltip="Approval needed" isPulsing />;
  }
  if (entry.status === "running") {
    return <NavigationDot variant="accent" label="A mission is running" tooltip="Mission running" isPulsing />;
  }
  return null;
}
