"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Theme } from "@astryxdesign/core/theme";
import type { ReactNode } from "react";
import { workspaceTheme } from "./workspace-theme";

export function WorkspaceFrame({ navigation, children, overlays }: { navigation: ReactNode; children: ReactNode; overlays?: ReactNode }) {
  return <Theme theme={workspaceTheme}>
    <AppShell variant="section" contentPadding={0} mobileNav={false} sideNav={navigation}>{children}</AppShell>
    {overlays}
  </Theme>;
}
