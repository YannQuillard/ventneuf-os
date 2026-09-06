export type NavigationEntryKind = "main" | "conversation" | "temporary" | "thread" | "channel" | "devices" | "usage";

export type NavigationStatus = "running" | "attention";

export interface NavigationEntry {
  id: string;
  kind: NavigationEntryKind;
  label: string;
  href?: string;
  isSelected: boolean;
  isDisabled?: boolean;
  status?: NavigationStatus;
  children: NavigationEntry[];
}

export interface NavigationGroup {
  id: "personal" | "projects" | "workspace";
  title: string;
  entries: NavigationEntry[];
}

export function workspaceNavigation(pathname: string, runnerOnline: boolean): NavigationGroup[] {
  return [
    { id: "personal", title: "Personal", entries: [{ id: "hermes", kind: "main", label: "Hermes", href: "/", isSelected: pathname === "/", children: [] }] },
    { id: "workspace", title: "Workspace", entries: [{ id: "devices", kind: "devices", label: "Devices", href: "/devices",
      isSelected: pathname === "/devices", status: runnerOnline ? "running" : undefined, children: [] }] },
  ];
}
