"use client";

import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, Layout, LayoutContent, LayoutFooter, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { List, ListItem } from "@astryxdesign/core/List";
import { DeviceSection } from "./_components/device-section";
import { useCallback, useEffect, useState } from "react";

const localRunnerUrl = "http://127.0.0.1:41929";

interface Device {
  id: string;
  name: string;
  platform: string;
  repositories?: Array<{ id: string; name: string; orcaReview?: boolean; codexDevelopment?: boolean; claudeDevelopment?: boolean }>;
  lastSeenAt?: string;
}

interface LocalStatus {
  status: "online" | "not_enrolled";
  device?: Device;
}

interface RunnerUpdateStatus {
  currentVersion: string;
  latestVersion: string;
  available: boolean;
}

function recentlySeen(device: Device) {
  return Boolean(device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 90_000);
}

function RegisterRepositoryDialog({ isOpen, onOpenChange, onRegistered, hasSearchFolders }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onRegistered: (name: string) => void;
  hasSearchFolders: boolean;
}) {
  const [githubUrl, setGitHubUrl] = useState("");
  const [searchRoot, setSearchRoot] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (isOpen) { setGitHubUrl(""); setSearchRoot(""); setError(undefined); }
  }, [isOpen]);

  const submit = async () => {
    if (!githubUrl.trim() || (!hasSearchFolders && !searchRoot.trim())) {
      setError("Enter a GitHub repository and an absolute search folder."); return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      const response = await fetch(`${localRunnerUrl}/repositories`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ githubUrl: githubUrl.trim(), ...(searchRoot.trim() ? { searchRoot: searchRoot.trim() } : {}) }),
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => undefined) as { message?: string } | undefined;
        throw new Error(failure?.message ?? "The local runner could not register this repository.");
      }
      const payload = await response.json() as { repository: { name: string } };
      onRegistered(payload.repository.name);
      onOpenChange(false);
    } catch (reason) {
      setError(reason instanceof TypeError
        ? "Start the ventneuf.os runner on this Mac, then try again."
        : reason instanceof Error ? reason.message : "Repository registration failed.");
    } finally { setSubmitting(false); }
  };

  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520}>
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title="Connect GitHub repository" subtitle="Match this repository to a checkout on this Mac" onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><FormLayout defaultOptionality="required">
        <TextInput label="GitHub repository" value={githubUrl} onChange={setGitHubUrl}
          placeholder="https://github.com/owner/repository" isRequired hasAutoFocus
          description="Use the same GitHub repository on each member's Mac to connect it to shared projects." />
        <TextInput label={hasSearchFolders ? "Add another search folder" : "Search folder"} value={searchRoot} onChange={setSearchRoot}
          placeholder="/Users/you/dev" isRequired={!hasSearchFolders} isOptional={hasSearchFolders}
          description={hasSearchFolders
            ? "Leave empty to search your saved folders. Paths never leave this Mac."
            : "This folder is saved by the runner for future repositories. Paths never leave this Mac."}
          onEnter={() => void submit()} />
        {error ? <Text type="supporting" color="primary" role="alert">{error}</Text> : null}
      </FormLayout></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label="Connect" variant="primary" isLoading={isSubmitting} clickAction={submit} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

function RunnerUpdateDialog({ isOpen, onOpenChange, status, onUpdate }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  status?: RunnerUpdateStatus;
  onUpdate: () => Promise<void>;
}) {
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="required" width={480}>
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title="Update runner" subtitle="Install the latest verified runner release" onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4}><VStack gap={3}>
        <Text>The runner will download a checksum-verified release and restart. Device identity, repository configuration, and agent settings stay unchanged.</Text>
        {status ? <Text type="supporting">Current {status.currentVersion.slice(0, 7)} · Latest {status.latestVersion.slice(0, 7)}</Text> : null}
      </VStack></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label="Update and restart" variant="primary" clickAction={onUpdate} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

export function RunnerSetup() {
  const [local, setLocal] = useState<LocalStatus>();
  const [cloudDevices, setCloudDevices] = useState<Device[]>([]);
  const [isLoaded, setLoaded] = useState(false);
  const [isConnecting, setConnecting] = useState(false);
  const [deviceError, setDeviceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [missionNotice, setMissionNotice] = useState<string>();
  const [repositoryNotice, setRepositoryNotice] = useState<string>();
  const [isRepositoryOpen, setRepositoryOpen] = useState(false);
  const [hasSearchFolders, setHasSearchFolders] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<RunnerUpdateStatus>();
  const [isUpdateOpen, setUpdateOpen] = useState(false);

  const refresh = useCallback(async () => {
    const [localResult, cloudResult] = await Promise.allSettled([
      fetch(`${localRunnerUrl}/status`, { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Local runner unavailable.");
        return response.json() as Promise<LocalStatus>;
      }),
      fetch("/api/devices", { cache: "no-store" }).then(async (response) => {
        if (!response.ok) throw new Error("Unable to load devices.");
        return response.json() as Promise<{ devices: Device[] }>;
      }),
    ]);
    setLocal(localResult.status === "fulfilled" ? localResult.value : undefined);
    if (localResult.status === "fulfilled" && localResult.value.status === "online") {
      try {
        const [updateResponse, settingsResponse] = await Promise.all([
          fetch(`${localRunnerUrl}/updates`, { cache: "no-store" }),
          fetch(`${localRunnerUrl}/repository-settings`, { cache: "no-store" }),
        ]);
        setUpdateStatus(updateResponse.ok ? await updateResponse.json() as RunnerUpdateStatus : undefined);
        setHasSearchFolders(settingsResponse.ok
          ? (await settingsResponse.json() as { hasSearchFolders: boolean }).hasSearchFolders
          : false);
      } catch { setUpdateStatus(undefined); setHasSearchFolders(false); }
    } else { setUpdateStatus(undefined); setHasSearchFolders(false); }
    if (cloudResult.status === "fulfilled") {
      setCloudDevices(cloudResult.value.devices);
      setDeviceError(undefined);
    } else setDeviceError("Unable to load your devices. Try refreshing.");
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(undefined);
    setConnecting(true);
    try {
      const enrollmentResponse = await fetch("/api/devices/enrollments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!enrollmentResponse.ok) throw new Error("Unable to create a device enrollment.");
      const enrollment = await enrollmentResponse.json() as { token: string };
      const runnerResponse = await fetch(`${localRunnerUrl}/enroll`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: enrollment.token }),
      });
      if (!runnerResponse.ok) {
        const failure = await runnerResponse.json().catch(() => undefined) as { message?: string } | undefined;
        throw new Error(failure?.message ?? "The local runner could not enroll this Mac.");
      }
      await refresh();
    } catch (reason) {
      setError(reason instanceof TypeError
        ? "Start the ventneuf.os runner on this Mac, then try again."
        : reason instanceof Error ? reason.message : "Runner setup failed.");
    } finally { setConnecting(false); }
  }, [refresh]);

  const checkRepository = async (deviceId: string, repositoryId: string, adapter = "repository-check") => {
    setMissionNotice(undefined);
    setError(undefined);
    try {
      const response = await fetch("/api/missions/runner", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ deviceId, repositoryId, adapter }),
      });
      if (!response.ok) throw new Error("Unable to start the repository mission.");
      setMissionNotice(`${adapter === "orca-review" ? "Read-only review" : "Repository check"} queued. Progress and results appear in the conversation.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to start the repository check.");
    }
  };

  const updateRunner = async () => {
    setError(undefined);
    try {
      const response = await fetch(`${localRunnerUrl}/updates/install`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      if (!response.ok) {
        const failure = await response.json().catch(() => undefined) as { message?: string } | undefined;
        throw new Error(failure?.message ?? "The runner update failed.");
      }
      setUpdateOpen(false);
      setRepositoryNotice("Runner update installed. Waiting for the local service to restart…");
      window.setTimeout(() => void refresh(), 3_000);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The runner update failed.");
      setUpdateOpen(false);
    }
  };

  return (
    <VStack gap={6} padding={4}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill"><Heading level={3}>Runners</Heading></StackItem>
        <Button label="Refresh" size="sm" variant="ghost" clickAction={() => void refresh()} />
        {local?.status === "online" ? <Button label="Connect repository" variant="secondary" size="sm"
          onClick={() => setRepositoryOpen(true)} /> : null}
        {local?.status === "online" && updateStatus?.available ? <Button label="Update runner" variant="primary" size="sm"
          onClick={() => setUpdateOpen(true)} /> : null}
        {local?.status !== "online" ? <Button label="Connect this Mac" variant="primary" size="sm" isLoading={isConnecting} clickAction={connect} /> : null}
      </HStack>
      {isLoaded ? cloudDevices.map((device) => (
        <DeviceSection key={device.id} name={device.name} isOnline={recentlySeen(device)}
          detail={device.platform === "darwin" ? "macOS" : device.platform} lastSeenAt={device.lastSeenAt}>
          {device.repositories?.length ? <List density="compact" hasDividers>
            {device.repositories.map((repository) => <ListItem key={repository.id} label={repository.name}
              description={[repository.codexDevelopment ? "Codex" : undefined, repository.claudeDevelopment ? "Claude Code" : undefined,
                repository.orcaReview ? "Read-only review" : undefined].filter(Boolean).join(" · ") || "Repository check"}
              endContent={<HStack gap={2} wrap="wrap">
                <Button label="Check" tooltip="Check this repository without changing files" size="sm" variant="secondary"
                  isDisabled={!recentlySeen(device)} clickAction={() => checkRepository(device.id, repository.id)} />
                {repository.orcaReview ? <Button label="Review" tooltip="Review committed source with Codex in read-only mode" size="sm" variant="secondary"
                  isDisabled={!recentlySeen(device)} clickAction={() => checkRepository(device.id, repository.id, "orca-review")} /> : null}
              </HStack>} />)}
          </List> : <Text type="supporting">No repositories registered on this runner.</Text>}
        </DeviceSection>
      )) : <Text type="supporting" role="status">Loading your devices…</Text>}
      {isLoaded && !deviceError && !cloudDevices.length ? <Text type="supporting">No devices connected yet. Start the runner on your Mac, then connect it here.</Text> : null}
      {local?.status === "online" && local.device && !cloudDevices.some((device) => device.id === local.device?.id) ? (
        <HStack gap={2}><StatusDot variant="success" label="Local runner connected" /><Text type="supporting">{local.device.name} is connected locally. Waiting for its cloud heartbeat.</Text></HStack>
      ) : null}
      {missionNotice ? <VStack gap={2}><Text type="supporting" role="status">{missionNotice}</Text><Button label="Open Hermes" href="/" variant="secondary" size="sm" /></VStack> : null}
      {repositoryNotice ? <Text type="supporting" role="status">{repositoryNotice}</Text> : null}
      {error || deviceError ? <Text type="supporting" role="alert">{error ?? deviceError}</Text> : null}
      <RegisterRepositoryDialog isOpen={isRepositoryOpen} onOpenChange={setRepositoryOpen} hasSearchFolders={hasSearchFolders} onRegistered={(name) => {
        setRepositoryNotice(`${name} was connected locally and will be available for projects after the next runner sync.`);
        setHasSearchFolders(true);
        window.setTimeout(() => void refresh(), 6_000);
      }} />
      <RunnerUpdateDialog isOpen={isUpdateOpen} onOpenChange={setUpdateOpen} status={updateStatus} onUpdate={updateRunner} />
    </VStack>
  );
}
