"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { CheckboxInput } from "@astryxdesign/core/CheckboxInput";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Selector } from "@astryxdesign/core/Selector";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useToast } from "@astryxdesign/core/Toast";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { DeviceSection } from "./_components/device-section";

const localRunnerUrl = "http://127.0.0.1:41929";

interface DeviceRepository {
  id: string; name: string; orcaReview?: boolean; codexDevelopment?: boolean; codexModels?: string[];
  claudeDevelopment?: boolean; claudeModels?: string[];
}
interface Device { id: string; name: string; platform: string; repositories?: DeviceRepository[]; lastSeenAt?: string }
interface LocalStatus { status: "online" | "not_enrolled"; device?: Device; harnesses?: { codex: boolean; claude: boolean } }
interface RunnerUpdateStatus { currentVersion: string; latestVersion: string; available: boolean }
interface GitHubStatus { connected: boolean; login?: string; installUrl: string }
interface GitHubRepository { id: string; fullName: string; private?: boolean; htmlUrl: string; cloneUrl: string }
interface LocalRepository {
  id: string; name: string; path: string; available: boolean;
  codexDevelopment?: boolean; codexModels?: string[]; claudeDevelopment?: boolean; claudeModels?: string[];
  github?: { id?: string; owner: string; name: string };
}
interface RepositorySettings {
  searchFolders: Array<{ path: string; available: boolean }>;
  repositories: LocalRepository[];
}

function recentlySeen(device: Device) {
  return Boolean(device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 90_000);
}

async function localRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${localRunnerUrl}${path}`, { cache: "no-store", ...init });
  if (!response.ok) {
    const failure = await response.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(failure?.message ?? "The local runner could not update its configuration.");
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

async function chooseLocalFolder() {
  const result = await localRequest<{ path?: string }>("/folders/select", { method: "POST" });
  return result.path;
}

function FolderPathField({ value, onChange, onError, label, description, isRequired = true }: {
  value: string; onChange: (value: string) => void; onError: (message: string) => void;
  label: string; description: string; isRequired?: boolean;
}) {
  const [isBrowsing, setBrowsing] = useState(false);
  const browse = async () => {
    setBrowsing(true);
    try { const path = await chooseLocalFolder(); if (path) onChange(path); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Unable to open the folder picker."); }
    finally { setBrowsing(false); }
  };
  return <HStack gap={2} vAlign="end">
    <StackItem size="fill"><TextInput label={label} value={value} onChange={onChange}
      placeholder="/Users/you/dev" description={description} isRequired={isRequired} isOptional={!isRequired} /></StackItem>
    <Button label="Browse…" variant="secondary" isLoading={isBrowsing} clickAction={browse} />
  </HStack>;
}

function FolderDialog({ isOpen, onOpenChange, currentPath, onSaved }: {
  isOpen: boolean; onOpenChange: (isOpen: boolean) => void; currentPath?: string; onSaved: () => Promise<void>;
}) {
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const [isSaving, setSaving] = useState(false);
  useEffect(() => { if (isOpen) { setPath(currentPath ?? ""); setError(undefined); } }, [currentPath, isOpen]);
  const save = async () => {
    if (!path.trim()) return setError("Enter or choose an absolute folder path.");
    setSaving(true); setError(undefined);
    try {
      await localRequest("/repository-search-folders", { method: currentPath ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(currentPath ? { currentPath, path: path.trim() } : { path: path.trim() }) });
      await onSaved(); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save this folder."); }
    finally { setSaving(false); }
  };
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560}>
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title={currentPath ? "Change search folder" : "Add search folder"}
        subtitle="The folder stays in this runner's local configuration" onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><FormLayout defaultOptionality="required">
        <FolderPathField label="Folder on this Mac" value={path} onChange={setPath} onError={setError}
          description="Repositories below this folder are discovered automatically. The path never leaves this Mac." />
        {error ? <Text type="supporting" role="alert">{error}</Text> : null}
      </FormLayout></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label="Save folder" variant="primary" isLoading={isSaving} clickAction={save} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

function RepositoryDialog({ isOpen, onOpenChange, repositories, searchFolderCount, initialRepositoryId, requirePath, onSaved }: {
  isOpen: boolean; onOpenChange: (isOpen: boolean) => void; repositories: GitHubRepository[]; searchFolderCount: number;
  initialRepositoryId?: string; requirePath?: boolean; onSaved: (name: string) => Promise<void>;
}) {
  const [repositoryId, setRepositoryId] = useState("");
  const [githubUrl, setGitHubUrl] = useState("");
  const [path, setPath] = useState("");
  const [error, setError] = useState<string>();
  const [isSaving, setSaving] = useState(false);
  useEffect(() => { if (isOpen) { setRepositoryId(initialRepositoryId ?? ""); setGitHubUrl(""); setPath(""); setError(undefined); } }, [initialRepositoryId, isOpen]);
  const save = async () => {
    const selected = repositories.find((repository) => repository.id === repositoryId);
    if (!selected && !githubUrl.trim()) return setError("Choose or enter a GitHub repository.");
    if ((requirePath || searchFolderCount === 0) && !path.trim()) return setError("Enter or choose the repository folder on this Mac.");
    setSaving(true); setError(undefined);
    try {
      const result = await localRequest<{ repository: { name: string } }>("/repositories", { method: "POST",
        headers: { "content-type": "application/json" }, body: JSON.stringify({
          githubUrl: selected?.cloneUrl ?? githubUrl.trim(),
          ...(selected && /^[0-9]+$/.test(selected.id) ? { githubRepositoryId: selected.id } : {}),
          ...(path.trim() ? { repositoryPath: path.trim() } : {}),
        }) });
      await onSaved(result.repository.name); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to connect this repository."); }
    finally { setSaving(false); }
  };
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560}>
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title={requirePath ? "Relocate repository" : "Connect repository"}
        subtitle={requirePath ? "Point this GitHub repository to its new local folder" : "Match a GitHub repository to this Mac"}
        onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><FormLayout defaultOptionality="required">
        {repositories.length ? <Selector label="GitHub repository" value={repositoryId} onChange={setRepositoryId}
          options={repositories.map((repository) => ({ value: repository.id, label: repository.fullName,
            description: repository.private ? "Private repository" : "Public repository" }))}
          placeholder="Choose a repository" hasSearch isRequired isDisabled={Boolean(initialRepositoryId)} />
          : <TextInput label="GitHub repository" value={githubUrl} onChange={setGitHubUrl}
            placeholder="https://github.com/owner/repository" isRequired hasAutoFocus />}
        <FolderPathField label="Repository folder on this Mac" value={path} onChange={setPath} onError={setError}
          isRequired={Boolean(requirePath || searchFolderCount === 0)} description={requirePath || searchFolderCount === 0
            ? "Choose the exact checkout. Its GitHub remote will be verified before saving."
            : "Optional. Leave empty to search your saved folders automatically."} />
        {error ? <Text type="supporting" role="alert">{error}</Text> : null}
      </FormLayout></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label={requirePath ? "Save new location" : "Connect"} variant="primary" isLoading={isSaving} clickAction={save} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

function HarnessDialog({ isOpen, onOpenChange, repository, available, onSaved }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  repository?: LocalRepository;
  available?: { codex: boolean; claude: boolean };
  onSaved: () => Promise<void>;
}) {
  const [codex, setCodex] = useState(false);
  const [codexModels, setCodexModels] = useState("");
  const [claude, setClaude] = useState(false);
  const [claudeModels, setClaudeModels] = useState<string[]>(["opus"]);
  const [error, setError] = useState<string>();
  const [isSaving, setSaving] = useState(false);
  useEffect(() => {
    if (!isOpen) return;
    setCodex(Boolean(repository?.codexDevelopment));
    setCodexModels(repository?.codexModels?.join(", ") ?? "");
    setClaude(Boolean(repository?.claudeDevelopment));
    setClaudeModels(repository?.claudeModels?.length ? repository.claudeModels : ["opus"]);
    setError(undefined);
  }, [isOpen, repository]);
  const save = async () => {
    if (!repository) return;
    const parsedCodexModels = codexModels.split(",").map(model => model.trim()).filter(Boolean);
    if (claude && !claudeModels.length) return setError("Choose at least one Claude Code model.");
    setSaving(true); setError(undefined);
    try {
      await localRequest("/repositories/capabilities", { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: repository.id, codexDevelopment: codex,
          ...(codex && parsedCodexModels.length ? { codexModels: parsedCodexModels } : {}),
          claudeDevelopment: claude, ...(claude ? { claudeModels } : {}) }) });
      await onSaved(); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save execution harnesses."); }
    finally { setSaving(false); }
  };
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={560}>
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title="Execution harnesses" subtitle={repository?.name} onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><FormLayout defaultOptionality="optional">
        <CheckboxInput label="Codex" value={codex} onChange={setCodex}
          description="Allow missions for this repository to run with your Codex subscription."
          isDisabled={available?.codex === false} disabledMessage="Codex is not configured in this runner service." />
        {codex ? <TextInput label="Codex models" value={codexModels} onChange={setCodexModels} isOptional
          placeholder="Use subscription default" description="Optional comma-separated model IDs available to this subscription." /> : null}
        <CheckboxInput label="Claude Code" value={claude} onChange={setClaude}
          description="Allow missions for this repository to run with your Claude Code subscription."
          isDisabled={available?.claude === false} disabledMessage="Claude Code is not configured in this runner service." />
        {claude ? <MultiSelector label="Claude Code models" value={claudeModels} onChange={setClaudeModels}
          options={[{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }, { value: "fable", label: "Fable" }]}
          triggerDisplay="labels" isRequired description="Models available for lead agents and native sub-agents." /> : null}
        {error ? <Text type="supporting" role="alert">{error}</Text> : null}
      </FormLayout></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label="Save harnesses" variant="primary" isLoading={isSaving} clickAction={save} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

function RunnerUpdateDialog({ isOpen, onOpenChange, status, onUpdate }: {
  isOpen: boolean; onOpenChange: (isOpen: boolean) => void; status?: RunnerUpdateStatus; onUpdate: () => Promise<void>;
}) {
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="required" width={480}>
    <Layout height="auto" defaultHasDividers header={<DialogHeader title="Update runner"
      subtitle="Install the latest verified runner release" onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><VStack gap={3}>
        <Text>The runner will update and restart. Device identity, repositories, and agent settings stay unchanged.</Text>
        {status ? <Text type="supporting">Current {status.currentVersion.slice(0, 7)} · Latest {status.latestVersion.slice(0, 7)}</Text> : null}
      </VStack></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end"><Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label="Update and restart" variant="primary" clickAction={onUpdate} /></HStack></LayoutFooter>} />
  </Dialog>;
}

function SectionHeader({ title, description, action, level = 4 }: {
  title: string; description: string; action?: ReactNode; level?: 3 | 4;
}) {
  return <HStack gap={3} vAlign="center" wrap="wrap"><StackItem size="fill"><VStack gap={1}>
    <Heading level={level}>{title}</Heading><Text type="supporting">{description}</Text>
  </VStack></StackItem>{action}</HStack>;
}

function LoadingSection({ index, titleWidth, descriptionWidth, rows = 1 }: {
  index: number; titleWidth: number; descriptionWidth: number; rows?: number;
}) {
  return <VStack gap={3}>
    <VStack gap={1}>
      <Skeleton width={titleWidth} height={22} index={index} />
      <Skeleton width={descriptionWidth} height={16} index={index + 1} />
    </VStack>
    <VStack gap={2}>
      {Array.from({ length: rows }, (_, row) =>
        <Skeleton key={row} width="100%" height={52} index={index + row + 2} />)}
    </VStack>
  </VStack>;
}

function RunnerSetupSkeleton() {
  return <VStack gap={6} padding={4}>
    <LoadingSection index={0} titleWidth={72} descriptionWidth={360} />
    <VStack gap={5}>
      <VStack gap={1}>
        <Skeleton width={92} height={22} index={3} />
        <Skeleton width={410} height={16} index={4} />
      </VStack>
      <LoadingSection index={5} titleWidth={126} descriptionWidth={420} />
      <LoadingSection index={8} titleWidth={112} descriptionWidth={460} rows={2} />
    </VStack>
    <LoadingSection index={12} titleWidth={82} descriptionWidth={350} />
  </VStack>;
}

export function RunnerSetup() {
  const toast = useToast();
  const [local, setLocal] = useState<LocalStatus>();
  const [cloudDevices, setCloudDevices] = useState<Device[]>([]);
  const [settings, setSettings] = useState<RepositorySettings>({ searchFolders: [], repositories: [] });
  const [githubStatus, setGitHubStatus] = useState<GitHubStatus>();
  const [githubRepositories, setGitHubRepositories] = useState<GitHubRepository[]>([]);
  const [hasGitHubRepositoryAccess, setHasGitHubRepositoryAccess] = useState<boolean>();
  const [updateStatus, setUpdateStatus] = useState<RunnerUpdateStatus>();
  const [isLoaded, setLoaded] = useState(false);
  const [isConnecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const [isFolderOpen, setFolderOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<string>();
  const [isRepositoryOpen, setRepositoryOpen] = useState(false);
  const [repositoryToLocate, setRepositoryToLocate] = useState<string>();
  const [repositoryToConfigure, setRepositoryToConfigure] = useState<string>();
  const [isUpdateOpen, setUpdateOpen] = useState(false);

  const refresh = useCallback(async (includeGitHub = true) => {
    setError(undefined);
    const [localResult, cloudResult, githubResult] = await Promise.allSettled([
      fetch(`${localRunnerUrl}/status`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Local runner unavailable."); return response.json() as Promise<LocalStatus>;
      }),
      fetch("/api/devices", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Unable to load devices."); return response.json() as Promise<{ devices: Device[] }>;
      }),
      includeGitHub ? fetch("/api/github", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("GitHub App unavailable."); return response.json() as Promise<GitHubStatus>;
      }) : Promise.resolve(undefined),
    ]);
    const localStatus = localResult.status === "fulfilled" ? localResult.value : undefined;
    setLocal(localStatus);
    if (localStatus?.status === "online") {
      const [updates, repositorySettings] = await Promise.allSettled([
        localRequest<RunnerUpdateStatus>("/updates"), localRequest<RepositorySettings>("/repository-settings"),
      ]);
      setUpdateStatus(updates.status === "fulfilled" ? updates.value : undefined);
      const value = repositorySettings.status === "fulfilled" ? repositorySettings.value : undefined;
      setSettings(value && Array.isArray(value.searchFolders) && Array.isArray(value.repositories)
        ? value : { searchFolders: [], repositories: [] });
    } else { setUpdateStatus(undefined); setSettings({ searchFolders: [], repositories: [] }); }
    if (cloudResult.status === "fulfilled") setCloudDevices(cloudResult.value.devices);
    else setError("Unable to load your runners. Try refreshing.");
    if (githubResult.status === "fulfilled" && githubResult.value) {
      setGitHubStatus(githubResult.value);
      if (githubResult.value.connected) {
        try {
          const response = await fetch("/api/github/repositories", { cache: "no-store" });
          if (!response.ok) throw new Error("GitHub repository access unavailable.");
          setGitHubRepositories((await response.json() as { repositories: GitHubRepository[] }).repositories);
          setHasGitHubRepositoryAccess(true);
        } catch { setGitHubRepositories([]); setHasGitHubRepositoryAccess(false); }
      } else { setGitHubRepositories([]); setHasGitHubRepositoryAccess(undefined); }
    } else if (githubResult.status === "rejected") {
      setGitHubStatus(undefined); setGitHubRepositories([]); setHasGitHubRepositoryAccess(false);
    }
    setLoaded(true);
  }, []);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(false), 15_000);
    return () => window.clearInterval(timer); }, [refresh]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const githubResult = url.searchParams.get("github");
    if (!githubResult) return;
    if (githubResult === "connected") {
      toast({ body: "GitHub connected", uniqueID: "github-connected" });
    } else if (githubResult === "error") {
      toast({ body: "GitHub could not be connected", type: "error", uniqueID: "github-connection-error" });
    }
    url.searchParams.delete("github");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [toast]);

  const connect = useCallback(async () => {
    setConnecting(true); setError(undefined);
    try {
      const enrollment = await fetch("/api/devices/enrollments", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!enrollment.ok) throw new Error("Unable to create a device enrollment.");
      const { token } = await enrollment.json() as { token: string };
      await localRequest("/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      await refresh();
    } catch (reason) { setError(reason instanceof TypeError ? "Start the ventneuf.os runner on this Mac, then try again."
      : reason instanceof Error ? reason.message : "Runner setup failed."); }
    finally { setConnecting(false); }
  }, [refresh]);

  const connectGitHub = async () => {
    try {
      const response = await fetch("/api/github/connect", { cache: "no-store" });
      const payload = await response.json() as { authorizationUrl?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error("Unable to start GitHub authorization.");
      window.location.assign(payload.authorizationUrl);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to connect GitHub."); }
  };
  const disconnectGitHub = async () => {
    try {
      const response = await fetch("/api/github", { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to disconnect GitHub.");
      await refresh(); toast({ body: "GitHub disconnected", uniqueID: "github-disconnected" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to disconnect GitHub."); }
  };
  const removeFolder = async (path: string) => {
    try {
      await localRequest("/repository-search-folders", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ path }) });
      await refresh(); toast({ body: "Search folder removed", uniqueID: "search-folder-removed" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove this folder."); }
  };
  const removeRepository = async (id: string) => {
    try {
      await localRequest("/repositories", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      await refresh(); toast({ body: "Local repository connection removed", uniqueID: "repository-removed" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove this repository."); }
  };
  const updateRunner = async () => {
    try {
      await localRequest("/updates/install", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      setUpdateOpen(false); toast({ body: "Runner updated. Waiting for restart…", isAutoHide: false, uniqueID: "runner-restarting" });
      window.setTimeout(() => void refresh(), 3_000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The runner update failed."); setUpdateOpen(false); }
  };

  const localByGitHubId = useMemo(() => new Map(settings.repositories.flatMap((repository) => {
    if (!repository.github) return [];
    const keys = [repository.github.id, `${repository.github.owner}/${repository.github.name}`.toLowerCase()]
      .filter(Boolean) as string[];
    return keys.map((key) => [key, repository] as const);
  })), [settings.repositories]);
  const repositoryChoices = useMemo(() => {
    const repositories = [...githubRepositories];
    const identities = new Set(repositories.flatMap((repository) => [repository.id, repository.fullName.toLowerCase()]));
    for (const repository of settings.repositories) {
      if (!repository.github) continue;
      const fullName = `${repository.github.owner}/${repository.github.name}`;
      if (identities.has(repository.github.id ?? "") || identities.has(fullName.toLowerCase())) continue;
      repositories.push({
        id: repository.github.id ?? `local:${fullName.toLowerCase()}`,
        fullName,
        htmlUrl: `https://github.com/${fullName}`,
        cloneUrl: `https://github.com/${fullName}.git`,
      });
    }
    return repositories;
  }, [githubRepositories, settings.repositories]);
  const connectedRepositories = useMemo(() => settings.repositories.map((repository) => {
    if (!repository.github) return { repository, fullName: repository.name };
    const fullName = `${repository.github.owner}/${repository.github.name}`;
    const githubRepository = githubRepositories.find((candidate) => candidate.id === repository.github?.id
      || candidate.fullName.toLowerCase() === fullName.toLowerCase());
    return {
      repository,
      fullName,
      choiceId: githubRepository?.id ?? repository.github.id ?? `local:${fullName.toLowerCase()}`,
      private: githubRepository?.private,
    };
  }), [githubRepositories, settings.repositories]);
  const repositoryBeingLocated = repositoryChoices.find(({ id }) => id === repositoryToLocate);
  const repositoryBeingConfigured = settings.repositories.find(({ id }) => id === repositoryToConfigure);
  const isRelocatingRepository = Boolean(repositoryBeingLocated && (localByGitHubId.get(repositoryBeingLocated.id)
    ?? localByGitHubId.get(repositoryBeingLocated.fullName.toLowerCase())));
  const capabilities = (repositories: DeviceRepository[]) => [
    repositories.some((repository) => repository.codexDevelopment) ? "Codex" : undefined,
    repositories.some((repository) => repository.claudeDevelopment) ? "Claude Code" : undefined,
    repositories.some((repository) => repository.orcaReview) ? "Read-only review" : undefined,
  ].filter(Boolean).join(" · ");

  if (!isLoaded) return <RunnerSetupSkeleton />;

  return <VStack gap={6} padding={4}>
    <VStack gap={3}><SectionHeader title="GitHub" level={3} description="Private repository access belongs to your member account." />
      {githubStatus ? <List density="compact" hasDividers><ListItem
        label={githubStatus.connected ? `@${githubStatus.login}` : "GitHub not connected"}
        description={githubStatus.connected ? hasGitHubRepositoryAccess === false ? "GitHub repository access is temporarily unavailable"
          : `${githubRepositories.length} repository${githubRepositories.length === 1 ? "" : "ies"} available to this member`
          : "Connect GitHub to choose repositories without sharing them with other members."}
        endContent={githubStatus.connected ? <HStack gap={2}>
          <Button label="Manage GitHub access" href={githubStatus.installUrl} variant="secondary" size="sm" />
          <MoreMenu label="GitHub options" size="sm" alignment="end" items={[{ label: "Disconnect", onClick: disconnectGitHub }]} />
        </HStack> : <Button label="Connect GitHub" variant="primary" size="sm" clickAction={connectGitHub} />} /></List> : null}
    </VStack>

    <VStack gap={3}><SectionHeader title="This Mac" level={3} description={local?.status === "online"
      ? "Local paths and repository discovery stay on this device." : "Connect the local runner to manage folders and repositories."}
      action={local?.status !== "online" ? <Button label="Connect this Mac" variant="primary" size="sm" isLoading={isConnecting} clickAction={connect} /> : undefined} />
      {local?.status === "online" ? <>
        <SectionHeader title="Search folders" description="The runner scans these folders when connecting a GitHub repository."
          action={<Button label="Add folder" size="sm" variant="secondary" onClick={() => { setFolderToEdit(undefined); setFolderOpen(true); }} />} />
        {settings.searchFolders.length ? <List density="compact" hasDividers>{settings.searchFolders.map((folder) => <ListItem key={folder.path}
          label={folder.path} description={folder.available ? "Available on this Mac" : "Folder not found"}
          startContent={folder.available ? undefined : <StatusDot variant="warning" label="Missing" />}
          endContent={<MoreMenu label={`Options for ${folder.path}`} size="sm" alignment="end" items={[
            { label: "Change folder", onClick: () => { setFolderToEdit(folder.path); setFolderOpen(true); } },
            { label: "Remove", onClick: () => void removeFolder(folder.path) },
          ]} />} />)}</List> : <Text type="supporting">No search folders yet. Add one, or locate each repository directly.</Text>}

        <SectionHeader title="Repositories" description="Repositories connected to this runner and their location on this Mac."
          action={<Button label="Connect repository" size="sm" variant="secondary" onClick={() => { setRepositoryToLocate(undefined); setRepositoryOpen(true); }} />} />
        {connectedRepositories.length ? <List density="compact" hasDividers>{connectedRepositories.map(({
          repository: localRepository, fullName, choiceId, private: isPrivate,
        }) => {
          const status = localRepository.available ? "Available on this Mac" : "Local folder not found";
          const visibility = isPrivate === undefined ? undefined : isPrivate ? "Private" : "Public";
          const harnesses = [localRepository.codexDevelopment ? "Codex" : undefined,
            localRepository.claudeDevelopment ? "Claude Code" : undefined].filter(Boolean).join(" · ");
          return <ListItem key={localRepository.id} label={fullName} description={[visibility, status, harnesses].filter(Boolean).join(" · ")}
            startContent={!localRepository.available ? <StatusDot variant="warning" label="Missing" /> : undefined}
            endContent={<HStack gap={2}>
              {!localRepository.available && choiceId ? <Button label="Relocate" size="sm" variant="secondary"
                onClick={() => { setRepositoryToLocate(choiceId); setRepositoryOpen(true); }} /> : null}
              <MoreMenu label={`Options for ${fullName}`} size="sm" alignment="end" items={[
                { label: "Execution harnesses", onClick: () => setRepositoryToConfigure(localRepository.id) },
                ...(choiceId ? [{ label: "Change local folder", onClick: () => { setRepositoryToLocate(choiceId); setRepositoryOpen(true); } }] : []),
                { label: "Remove from this Mac", onClick: () => void removeRepository(localRepository.id) },
              ]} />
            </HStack>} />;
        })}</List> : <Text type="supporting">No repositories connected to this runner yet.</Text>}
      </> : null}
    </VStack>

    <VStack gap={3}><SectionHeader title="Runners" level={3} description="Enrolled Macs, their presence, and execution harnesses." />
      {isLoaded && cloudDevices.length ? cloudDevices.map((device) => {
        const repositories = device.repositories ?? [];
        const harnesses = capabilities(repositories);
        const isLocal = local?.device?.id === device.id;
        return <DeviceSection key={device.id} name={device.name} isOnline={recentlySeen(device)}
          detail={[device.platform === "darwin" ? "macOS" : device.platform, `${repositories.length} repositor${repositories.length === 1 ? "y" : "ies"}`, harnesses].filter(Boolean).join(" · ")}
          lastSeenAt={device.lastSeenAt} actions={isLocal && updateStatus?.available
            ? <Button label="Update runner" size="sm" variant="primary" onClick={() => setUpdateOpen(true)} /> : undefined} />;
      }) : <Text type="supporting">{isLoaded ? "No runners enrolled yet." : "Loading runners…"}</Text>}
    </VStack>

    {error ? <Banner status="error" title="Devices could not be updated" description={error} /> : null}
    <FolderDialog isOpen={isFolderOpen} onOpenChange={setFolderOpen} currentPath={folderToEdit}
      onSaved={async () => { await refresh(); toast({ body: folderToEdit ? "Search folder updated" : "Search folder added" }); }} />
    <RepositoryDialog isOpen={isRepositoryOpen} onOpenChange={setRepositoryOpen} repositories={repositoryChoices}
      searchFolderCount={settings.searchFolders.filter(({ available }) => available).length} initialRepositoryId={repositoryToLocate}
      requirePath={isRelocatingRepository}
      onSaved={async (name) => { await refresh(); toast({ body: `${name} connected to this Mac`, uniqueID: "repository-connected" }); }} />
    <HarnessDialog isOpen={Boolean(repositoryToConfigure)} onOpenChange={isOpen => { if (!isOpen) setRepositoryToConfigure(undefined); }}
      repository={repositoryBeingConfigured} available={local?.harnesses}
      onSaved={async () => { await refresh(); toast({ body: "Execution harnesses updated", uniqueID: "repository-harnesses-updated" }); }} />
    <RunnerUpdateDialog isOpen={isUpdateOpen} onOpenChange={setUpdateOpen} status={updateStatus} onUpdate={updateRunner} />
  </VStack>;
}
