"use client";

import { Button } from "@astryxdesign/core/Button";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { useCallback, useEffect, useState } from "react";

const localRunnerUrl = "http://127.0.0.1:41929";

interface Device {
  id: string;
  name: string;
  platform: string;
  repositories?: Array<{ id: string; name: string; orcaReview?: boolean }>;
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
    if (cloudResult.status === "fulfilled") setCloudDevices(cloudResult.value.devices);
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const connect = useCallback(async () => {
    setError(undefined);
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
    }
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

  const currentDevice = local?.device;
  const onlineCount = cloudDevices.filter(recentlySeen).length;
  const isOnline = local?.status === "online" || onlineCount > 0;
  const title = currentDevice?.name ?? (onlineCount > 0 ? `${onlineCount} runner${onlineCount === 1 ? "" : "s"}` : "This Mac");
  const detail = currentDevice
    ? "Runner online"
    : error ?? (local?.status === "not_enrolled" ? "Ready to connect" : onlineCount > 0 ? "Online" : "Runner not connected");

  return (
    <VStack gap={2} padding={3}>
      <HStack gap={2} vAlign="center">
        <StatusDot variant={isOnline ? "success" : error ? "error" : "neutral"} label={detail} />
        <VStack gap={0}>
          <Text type="label" weight="semibold">{title}</Text>
          <Text type="supporting" color="secondary" maxLines={2}>{detail}</Text>
        </VStack>
      </HStack>
      {cloudDevices.flatMap((device) => (device.repositories ?? []).map((repository) => (
        <HStack key={`${device.id}:${repository.id}`} gap={2} vAlign="center">
          <VStack gap={0}>
            <Text type="label">{repository.name}</Text>
            <Text type="supporting" color="secondary">{device.name}</Text>
          </VStack>
          <Button label="Check" tooltip="Check this repository without changing files" size="sm" variant="ghost"
            isDisabled={!recentlySeen(device)} clickAction={() => checkRepository(device.id, repository.id)} />
          {repository.orcaReview ? <Button label="Review" tooltip="Review committed source with Codex in read-only mode" size="sm" variant="ghost"
            isDisabled={!recentlySeen(device)} clickAction={() => checkRepository(device.id, repository.id, "orca-review")} /> : null}
        </HStack>
      )))}
      {missionNotice ? <Text type="supporting" color="secondary" role="status">{missionNotice}</Text> : null}
      {error ? <Text type="supporting" role="alert">{error}</Text> : null}
      {local?.status !== "online" ? (
        <Button label="Connect this Mac" variant="secondary" size="sm" width="100%" clickAction={connect} />
      ) : null}
    </VStack>
  );
}
