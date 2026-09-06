"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack, StackItem, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Heading, Text } from "@astryxdesign/core/Text";
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

function recentlySeen(device: Device) {
  return Boolean(device.lastSeenAt && Date.now() - new Date(device.lastSeenAt).getTime() < 90_000);
}

export function RunnerSetup() {
  const [local, setLocal] = useState<LocalStatus>();
  const [cloudDevices, setCloudDevices] = useState<Device[]>([]);
  const [isLoaded, setLoaded] = useState(false);
  const [isConnecting, setConnecting] = useState(false);
  const [deviceError, setDeviceError] = useState<string>();
  const [error, setError] = useState<string>();
  const [missionNotice, setMissionNotice] = useState<string>();

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

  return (
    <VStack gap={6} padding={4}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <StackItem size="fill"><Heading level={3}>Runners</Heading></StackItem>
        <Button label="Refresh" size="sm" variant="ghost" clickAction={() => void refresh()} />
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
      {error || deviceError ? <Text type="supporting" role="alert">{error ?? deviceError}</Text> : null}
    </VStack>
  );
}
