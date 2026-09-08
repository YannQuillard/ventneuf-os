"use client";

import { CommandPalette, CommandPaletteFooter } from "@astryxdesign/core/CommandPalette";
import { useHotkeys, useMediaQuery } from "@astryxdesign/core/hooks";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { workspaceNavigation } from "../lib/workspace-navigation";
import { conversationHref, workspaceRequest, type WorkspaceConversation, type WorkspaceDevice, type WorkspaceProject, type WorkspaceSnapshot } from "../lib/workspace";
import { NavigationRows } from "./_components/navigation-rows";
import { WorkspaceFrame } from "./_components/workspace-frame";
import { EditDisplayNameDialog, NewConversationDialog, NewProjectDialog } from "./_components/workspace-dialogs";
import { WorkspaceSideNav } from "./_components/workspace-side-nav";
import { UpdateNotifications } from "./_components/update-notifications";
import styles from "./workspace.module.css";

interface WorkspaceContextValue {
  isMobile: boolean;
  openNavigation: () => void;
  openNewConversation: () => void;
  openNewProject: () => void;
  snapshot?: WorkspaceSnapshot;
  devices: WorkspaceDevice[];
  isLoading: boolean;
  error?: string;
  refreshWorkspace: () => Promise<void>;
}

const NavigationContext = createContext<WorkspaceContextValue>({
  isMobile: false, openNavigation: () => {}, openNewConversation: () => {}, openNewProject: () => {},
  devices: [], isLoading: true, refreshWorkspace: async () => {},
});

export const useWorkspaceNavigation = () => useContext(NavigationContext);

export function Workspace({ email, children }: { email: string; children: ReactNode }) {
  const [isPaletteOpen, setPaletteOpen] = useState(false);
  const [isNavigationOpen, setNavigationOpen] = useState(false);
  const [isConversationDialogOpen, setConversationDialogOpen] = useState(false);
  const [isProjectDialogOpen, setProjectDialogOpen] = useState(false);
  const [isDisplayNameOpen, setDisplayNameOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>();
  const [devices, setDevices] = useState<WorkspaceDevice[]>([]);
  const [isLoading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const isMobile = useMediaQuery("(max-width: 768px)");
  const pathname = usePathname();
  const router = useRouter();

  const refreshWorkspace = useCallback(async () => {
    try {
      setSnapshot(await workspaceRequest<WorkspaceSnapshot>(""));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load the workspace.");
    } finally { setLoading(false); }
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const response = await fetch("/api/devices", { cache: "no-store" });
      if (!response.ok) return;
      const payload = await response.json() as { devices: WorkspaceDevice[] };
      setDevices(payload.devices);
    } catch { /* Repository choices remain empty until device presence can be refreshed. */ }
  }, []);

  useEffect(() => { void refreshWorkspace(); void refreshDevices(); }, [refreshDevices, refreshWorkspace]);
  useEffect(() => {
    const timer = window.setInterval(() => void refreshDevices(), 15_000);
    return () => window.clearInterval(timer);
  }, [refreshDevices]);

  const online = (device: WorkspaceDevice) => Boolean(device.lastSeenAt && Date.now() - Date.parse(device.lastSeenAt) < 90_000);
  const device = devices.find(online) ?? devices[0];
  const navigation = useMemo(() => workspaceNavigation(pathname, devices.some(online), snapshot), [devices, pathname, snapshot]);
  const commands = useMemo(() => [
    { id: "new-conversation", label: "New conversation", auxiliaryData: { group: "Create" } },
    { id: "new-project", label: "New project", auxiliaryData: { group: "Create" } },
    ...(snapshot?.conversations ?? []).map((conversation) => ({ id: conversationHref(conversation), label: conversation.title, auxiliaryData: { group: conversation.projectId ? "Project threads" : "Personal" } })),
    ...(snapshot?.projects ?? []).map((project) => ({ id: `/projects/${encodeURIComponent(project.id)}`, label: project.name, auxiliaryData: { group: "Projects" } })),
    { id: "/memory", label: "Memory", auxiliaryData: { group: "Workspace" } },
    { id: "/devices", label: "Devices", auxiliaryData: { group: "Workspace" } },
    { id: "sign-out", label: "Sign out", auxiliaryData: { group: "Account" } },
  ], [snapshot]);
  const searchSource = useMemo(() => createStaticSource(commands), [commands]);
  const navigate = useCallback((href: string) => { setNavigationOpen(false); setPaletteOpen(false); router.push(href); }, [router]);
  const signOut = () => window.location.assign("/auth/logout");
  const accountActions = <MoreMenu label="Account options" size="sm" placement="above" items={[
    { label: "Edit display name", onClick: () => setDisplayNameOpen(true) },
    { label: "Sign out", onClick: signOut },
  ]} />;
  const openNewConversation = useCallback(() => { setPaletteOpen(false); setNavigationOpen(false); setConversationDialogOpen(true); }, []);
  const openNewProject = useCallback(() => { setPaletteOpen(false); setNavigationOpen(false); setProjectDialogOpen(true); }, []);

  const createConversation = async (title?: string) => {
    const { conversation } = await workspaceRequest<{ conversation: WorkspaceConversation }>("/conversations", {
      method: "POST", body: JSON.stringify({ title, kind: "private" }),
    });
    await refreshWorkspace(); navigate(conversationHref(conversation));
  };
  const createProject = async (input: { name: string; context?: { description: string }; repositoryAssociations: Array<{ deviceId: string; repositoryId: string }> }) => {
    const { project } = await workspaceRequest<{ project: WorkspaceProject }>("/projects", {
      method: "POST", body: JSON.stringify(input),
    });
    await refreshWorkspace(); navigate(`/projects/${encodeURIComponent(project.id)}`);
  };
  const runCommand = (id: string) => {
    if (id === "new-conversation") return openNewConversation();
    if (id === "new-project") return openNewProject();
    if (id === "sign-out") return signOut();
    navigate(id);
  };

  useHotkeys([{ keys: "mod+p", onPress: () => setPaletteOpen(true), allowInInputs: true }]);
  const showsNavigation = isMobile && isNavigationOpen;
  const member = snapshot?.currentMember ?? { id: "", name: email };
  const context = useMemo<WorkspaceContextValue>(() => ({ isMobile, openNavigation: () => setNavigationOpen(true),
    openNewConversation, openNewProject, snapshot, devices, isLoading, error, refreshWorkspace,
  }), [devices, error, isLoading, isMobile, openNewConversation, openNewProject, refreshWorkspace, snapshot]);

  return <NavigationContext value={context}>
    <UpdateNotifications />
    <WorkspaceFrame navigation={<WorkspaceSideNav navigation={navigation} member={member}
      onOpenSearch={() => setPaletteOpen(true)} onNewConversation={openNewConversation} onNewProject={openNewProject}
      accountActions={accountActions} />} overlays={<>
      <CommandPalette isOpen={isPaletteOpen} onOpenChange={setPaletteOpen} searchSource={searchSource}
        label="Search conversations, missions, projects, and memory" onValueChange={runCommand}
        footer={<CommandPaletteFooter />} width={640} />
      <NewConversationDialog isOpen={isConversationDialogOpen} onOpenChange={setConversationDialogOpen} onCreate={createConversation} />
      <NewProjectDialog isOpen={isProjectDialogOpen} onOpenChange={setProjectDialogOpen} devices={devices} onCreate={createProject} />
      <EditDisplayNameDialog isOpen={isDisplayNameOpen} onOpenChange={setDisplayNameOpen} currentName={member.name}
        onSave={async (name) => { await workspaceRequest("/me", { method: "PATCH", body: JSON.stringify({ name }) }); await refreshWorkspace(); }} />
    </>}>
      {showsNavigation ? <NavigationRows navigation={navigation} member={member}
        device={device ? { name: device.name, isOnline: online(device) } : undefined}
        onNavigate={navigate} onOpenSearch={() => setPaletteOpen(true)} onNewConversation={openNewConversation}
        onNewProject={openNewProject} accountActions={accountActions} /> : null}
      <div className={styles.page} hidden={showsNavigation}>{children}</div>
    </WorkspaceFrame>
  </NavigationContext>;
}
