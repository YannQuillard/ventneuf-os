"use client";

import { AppShell } from "@astryxdesign/core/AppShell";
import { CommandPalette, CommandPaletteFooter } from "@astryxdesign/core/CommandPalette";
import { useHotkeys, useMediaQuery } from "@astryxdesign/core/hooks";
import { Icon, type IconType } from "@astryxdesign/core/Icon";
import { Item } from "@astryxdesign/core/Item";
import { Theme } from "@astryxdesign/core/theme";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import {
  ArrowTopRightOnSquareIcon,
  BookOpenIcon,
  ChartBarIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleOvalLeftIcon,
  ComputerDesktopIcon,
  DocumentTextIcon,
  HashtagIcon,
  PlusIcon,
  RocketLaunchIcon,
  ShieldExclamationIcon,
  Squares2X2Icon,
} from "@heroicons/react/24/outline";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildNavigation, conversationHref, selectionFromPath } from "../../../lib/prototype/navigation";
import { conversationById, currentMember } from "../../../lib/prototype/state";
import { NewConversationDialog } from "./conversation-dialogs";
import { NavigationRows } from "./navigation-rows";
import { usePrototype } from "./prototype-provider";
import { prototypeTheme } from "./prototype-theme";
import { buildSearchItems, SEARCH_ACTIONS, type SearchItem, type SearchItemKind } from "./search-items";
import { ShellContext, type ShellContextValue } from "./shell-context";
import { WorkspaceSideNav } from "./workspace-side-nav";

const MOBILE_QUERY = "(max-width: 768px)";
const COMPACT_QUERY = "(max-width: 1100px)";

const searchIcons: Record<SearchItemKind, IconType> = {
  action: PlusIcon,
  conversation: ChatBubbleOvalLeftIcon,
  thread: ChatBubbleLeftEllipsisIcon,
  channel: HashtagIcon,
  project: Squares2X2Icon,
  mission: RocketLaunchIcon,
  approval: ShieldExclamationIcon,
  "pull-request": ArrowTopRightOnSquareIcon,
  file: DocumentTextIcon,
  knowledge: BookOpenIcon,
  device: ComputerDesktopIcon,
  usage: ChartBarIcon,
};

function SearchResult({ item }: { item: SearchItem }) {
  return (
    <Item
      density="compact"
      layout="inline"
      label={item.label}
      description={item.auxiliaryData.detail}
      startContent={<Icon icon={searchIcons[item.auxiliaryData.kind]} size="sm" color="secondary" />}
    />
  );
}

export function PrototypeShell({ children }: { children: ReactNode }) {
  const { data, dispatch, clock } = usePrototype();
  const pathname = usePathname();
  const router = useRouter();
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const isCompact = useMediaQuery(COMPACT_QUERY);
  const [isNavigationOpen, setNavigationOpen] = useState(false);
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [newConversation, setNewConversation] = useState<{ isOpen: boolean; isTemporary: boolean }>({ isOpen: false, isTemporary: false });
  const selectedId = selectionFromPath(pathname);
  const navigation = useMemo(() => buildNavigation(data, selectedId), [data, selectedId]);
  const searchItems = useMemo(() => buildSearchItems(data), [data]);
  const searchSource = useMemo(() => createStaticSource(searchItems, {
    keywords: (item) => [item.auxiliaryData.group, item.auxiliaryData.detail ?? ""],
  }), [searchItems]);
  const member = currentMember(data);
  const device = data.devices.find((entry) => entry.isOnline && !entry.isRevoked) ?? data.devices[0];

  useEffect(() => {
    if (!selectedId || !conversationById(data, selectedId)) return;
    dispatch({ type: "visitConversation", conversationId: selectedId, at: clock() });
    // The visit only depends on the selected conversation, not on every data change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const openNewConversation = useCallback((isTemporary = false) => {
    setPaletteOpen(false);
    setNavigationOpen(false);
    setNewConversation({ isOpen: true, isTemporary });
  }, []);

  const createConversation = useCallback((title: string, isTemporary: boolean) => {
    const conversationId = `conv-${Date.now().toString(36)}`;
    dispatch({ type: "createConversation", conversationId, title, isTemporary, at: clock() });
    navigate(conversationHref(conversationId));
  }, [clock, dispatch, navigate]);

  const runSearchItem = useCallback((id: string) => {
    if (id === SEARCH_ACTIONS.newConversation) return openNewConversation(false);
    if (id === SEARCH_ACTIONS.newTemporaryConversation) return openNewConversation(true);
    const item = searchItems.find((entry) => entry.id === id);
    setPaletteOpen(false);
    if (item?.auxiliaryData.href) navigate(item.auxiliaryData.href);
  }, [navigate, openNewConversation, searchItems]);

  const shell = useMemo<ShellContextValue>(() => ({
    isMobile,
    isCompact,
    openNavigation: () => setNavigationOpen(true),
    openSearch,
    openNewConversation,
    navigate,
  }), [isCompact, isMobile, navigate, openNewConversation, openSearch]);

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
              onOpenSearch={openSearch}
              onNewConversation={() => openNewConversation(false)}
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
              onNewConversation={() => openNewConversation(false)}
            />
          ) : children}
        </AppShell>
        <CommandPalette
          isOpen={isPaletteOpen}
          onOpenChange={setPaletteOpen}
          searchSource={searchSource}
          label="Search conversations, missions, files, and knowledge"
          onValueChange={runSearchItem}
          renderItem={(item) => <SearchResult item={item} />}
          footer={<CommandPaletteFooter />}
          width={640}
        />
        <NewConversationDialog
          isOpen={newConversation.isOpen}
          initialIsTemporary={newConversation.isTemporary}
          onOpenChange={(isOpen) => setNewConversation((current) => ({ ...current, isOpen }))}
          onCreate={createConversation}
        />
      </Theme>
    </ShellContext>
  );
}
