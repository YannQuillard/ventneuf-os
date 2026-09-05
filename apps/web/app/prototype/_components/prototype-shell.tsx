"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { Theme } from "@astryxdesign/core/theme";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { useHotkeys, useMediaQuery } from "@astryxdesign/core/hooks";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildNavigation } from "../../../lib/prototype/navigation";
import { currentMember } from "../../../lib/prototype/state";
import { NavigationRows } from "./navigation-rows";
import { usePrototype } from "./prototype-provider";
import { prototypeTheme } from "./prototype-theme";
import { buildSearchItems } from "./search-items";
import { ShellContext, type ShellContextValue } from "./shell-context";
import { WorkspaceSideNav } from "./workspace-side-nav";

const MOBILE_QUERY = "(max-width: 768px)";
const COMPACT_QUERY = "(max-width: 1100px)";

function conversationIdFromPath(pathname: string): string | undefined {
  const match = /^\/prototype\/c\/([^/]+)/.exec(pathname);
  return match?.[1];
}

export function PrototypeShell({ children }: { children: ReactNode }) {
  const { data, dispatch, clock } = usePrototype();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [isNavigationOpen, setNavigationOpen] = useState(false);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const selectedId = conversationIdFromPath(pathname);
  const navigation = useMemo(() => buildNavigation(data, selectedId), [data, selectedId]);
  const searchSource = useMemo(() => createStaticSource(buildSearchItems(data)), [data]);
  const member = currentMember(data);
  const device = data.devices[0];

  useEffect(() => {
    if (!selectedId) return;
    dispatch({ type: "visitConversation", conversationId: selectedId, at: clock() });
  }, [clock, dispatch, selectedId]);

  useHotkeys([
    { keys: "mod+p", onPress: () => setPaletteOpen(true), allowInInputs: true },
  ]);

  const navigate = useCallback((href: string) => {
    setNavigationOpen(false);
    setPaletteOpen(false);
    router.push(href);
  }, [router]);

  const openSearch = useCallback(() => setPaletteOpen(true), []);

  const runSearchItem = useCallback((id: string) => {
    const items = buildSearchItems(data);
    const item = items.find((entry) => entry.id === id);
    setPaletteOpen(false);
    if (item?.auxiliaryData.href) navigate(item.auxiliaryData.href);
  }, [data, navigate]);

  const shell = useMemo<ShellContextValue>(() => ({
    isMobile,
    isCompact,
    openNavigation: () => setNavigationOpen(true),
    openSearch,
    navigate,
  }), [isCompact, isMobile, navigate, openSearch]);

  const showsNavigationRows = isMobile && isNavigationOpen;

  return (
    <ShellContext value={shell}>
      <Theme theme={prototypeTheme}>
      <AppShell
        variant="section"
        contentPadding={0}
        mobileNav={false}
        sideNav={(
          <WorkspaceSideNav
            navigation={navigation}
            member={member}
            device={device}
            onOpenSearch={openSearch}
          />
        )}
      >
        {showsNavigationRows ? (
          <NavigationRows
            navigation={navigation}
            member={member}
            device={device}
            onNavigate={navigate}
            onOpenSearch={openSearch}
          />
        ) : children}
      </AppShell>
      <CommandPalette
        isOpen={isPaletteOpen}
        onOpenChange={setPaletteOpen}
        searchSource={searchSource}
        label="Search conversations, missions, files, and knowledge"
        onValueChange={runSearchItem}
      />
      </Theme>
    </ShellContext>
  );
}
