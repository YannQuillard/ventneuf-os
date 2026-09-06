"use client";

import { CommandPalette, CommandPaletteFooter } from "@astryxdesign/core/CommandPalette";
import { useHotkeys, useMediaQuery } from "@astryxdesign/core/hooks";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { workspaceNavigation } from "../lib/workspace-navigation";
import { NavigationRows } from "./_components/navigation-rows";
import { WorkspaceFrame } from "./_components/workspace-frame";
import { WorkspaceSideNav } from "./_components/workspace-side-nav";
import styles from "./workspace.module.css";

const NavigationContext = createContext({ isMobile: false, openNavigation: () => {} });
export const useWorkspaceNavigation = () => useContext(NavigationContext);

const commands = [
  { id: "/", label: "Hermes", auxiliaryData: { group: "Personal" } },
  { id: "/devices", label: "Devices", auxiliaryData: { group: "Workspace" } },
  { id: "sign-out", label: "Sign out", auxiliaryData: { group: "Account" } },
];

export function Workspace({ email, children }: { email: string; children: ReactNode }) {
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [isNavigationOpen, setNavigationOpen] = useState(false);
  const [device, setDevice] = useState<{ name: string; isOnline: boolean }>();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const pathname = usePathname();
  const router = useRouter();
  const searchSource = useMemo(() => createStaticSource(commands), []);
  const member = { name: email };
  const navigation = workspaceNavigation(pathname, device?.isOnline === true);
  const navigate = useCallback((href: string) => {
    setNavigationOpen(false);
    setPaletteOpen(false);
    router.push(href);
  }, [router]);
  const signOut = () => window.location.assign("/auth/logout");
  const accountActions = <MoreMenu label="Account options" size="sm" placement="above"
    items={[{ label: "Sign out", onClick: signOut }]} />;

  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/devices", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const { devices } = await response.json() as { devices: Array<{ name: string; lastSeenAt?: string }> };
        const online = (entry: typeof devices[number]) => Boolean(entry.lastSeenAt && Date.now() - Date.parse(entry.lastSeenAt) < 90_000);
        const current = devices.find(online) ?? devices[0];
        setDevice(current ? { name: current.name, isOnline: online(current) } : undefined);
      } catch { /* Navigation remains available when device presence cannot be refreshed. */ }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { controller.abort(); clearInterval(timer); };
  }, []);

  useHotkeys([{ keys: "mod+p", onPress: () => setPaletteOpen(true), allowInInputs: true }]);
  const showsNavigation = isMobile && isNavigationOpen;

  return (
    <NavigationContext value={{ isMobile, openNavigation: () => setNavigationOpen(true) }}>
      <WorkspaceFrame navigation={<WorkspaceSideNav navigation={navigation} member={member}
        onOpenSearch={() => setPaletteOpen(true)} accountActions={accountActions} />} overlays={
      <CommandPalette isOpen={isPaletteOpen} onOpenChange={setPaletteOpen} searchSource={searchSource}
        label="Search and actions" onValueChange={(id) => id === "sign-out" ? signOut() : navigate(id)}
        footer={<CommandPaletteFooter />} width={640} />
      }>
        {showsNavigation ? <NavigationRows navigation={navigation} member={member} device={device}
          onNavigate={navigate} onOpenSearch={() => setPaletteOpen(true)} accountActions={accountActions} /> : null}
        <div className={styles.page} hidden={showsNavigation}>{children}</div>
      </WorkspaceFrame>

    </NavigationContext>
  );
}
