"use client";

import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { ComputerDesktopIcon } from "@heroicons/react/24/outline";
import { PageHeader } from "../_components/page-header";
import { RunnerSetup } from "../runner-setup";
import { useWorkspaceNavigation } from "../workspace";

export function DevicesScreen() {
  const { isMobile, openNavigation } = useWorkspaceNavigation();
  return <Layout height="fill" header={<PageHeader title="Devices" subtitle="Enrolled runners and registered repositories"
    icon={ComputerDesktopIcon} onOpenNavigation={isMobile ? openNavigation : undefined} />}
    content={<LayoutContent padding={0} label="Devices"><RunnerSetup /></LayoutContent>} />;
}
