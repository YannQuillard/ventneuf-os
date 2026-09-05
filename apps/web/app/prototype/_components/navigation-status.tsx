"use client";

import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { NavigationEntry } from "../../../lib/prototype/navigation";

export function NavigationEndContent({ entry }: { entry: NavigationEntry }) {
  if (entry.status === "attention") {
    return <StatusDot variant="warning" label="An approval needs your decision" tooltip="Approval needed" isPulsing />;
  }
  if (entry.status === "running") {
    return <StatusDot variant="accent" label="A mission is running" tooltip="Mission running" isPulsing />;
  }
  return null;
}
