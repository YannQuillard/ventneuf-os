"use client";

import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { HStack, Layout, LayoutContent, LayoutFooter, LayoutHeader, StackItem, VStack } from "@astryxdesign/core/Layout";
import { List, ListItem } from "@astryxdesign/core/List";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { MoreMenu } from "@astryxdesign/core/MoreMenu";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Step, Stepper } from "@astryxdesign/core/Stepper";
import { Switch } from "@astryxdesign/core/Switch";
import { Heading, Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { Timestamp } from "@astryxdesign/core/Timestamp";
import { CodeBracketIcon, ComputerDesktopIcon, LinkIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { formatCount } from "../../../lib/prototype/format";
import { memberById } from "../../../lib/prototype/state";
import type { Connector, Device, DeviceCapability } from "../../../lib/prototype/types";
import { usePrototype } from "./prototype-provider";
import { useShell } from "./shell-context";

const capabilityLabels: Array<{ id: DeviceCapability; label: string }> = [
  { id: "check", label: "Check" },
  { id: "review", label: "Review" },
  { id: "codexDevelopment", label: "Codex" },
  { id: "claudeDevelopment", label: "Claude" },
];

const connectorStatus: Record<Connector["status"], { dot: "success" | "warning" | "neutral"; label: string }> = {
  connected: { dot: "success", label: "Connected" },
  needs_auth: { dot: "warning", label: "Needs authorisation" },
  disconnected: { dot: "neutral", label: "Disconnected" },
};

const metadataLabel = { position: "start", width: 128 } as const;

function ConnectDeviceDialog({ isOpen, onOpenChange, onDone }: { isOpen: boolean; onOpenChange: (isOpen: boolean) => void; onDone: (name: string) => void }) {
  const [name, setName] = useState("This Mac");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    const first = window.setTimeout(() => setStep(1), 900);
    const second = window.setTimeout(() => setStep(2), 1_900);
    const third = window.setTimeout(() => setStep(3), 2_800);
    return () => {
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.clearTimeout(third);
    };
  }, [isOpen]);

  return (
    <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={480}>
      <Layout
        height="auto"
        defaultHasDividers
        header={<DialogHeader title="Connect this Mac" subtitle="Enrol the local runner without copying a token" onOpenChange={onOpenChange} />}
        content={(
          <LayoutContent padding={4}>
            <VStack gap={4}>
              <FormLayout>
                <TextInput label="Device name" value={name} onChange={setName} />
              </FormLayout>
              <Stepper activeStep={step} orientation="vertical" density="compact" label="Enrolment" indicatorPosition="on-track">
                <Step step={0} label="Create a ten-minute enrolment token" description="Tenant-scoped, single use, only its hash is stored" />
                <Step step={1} label="Hand it to the local runner" description="Sent to the loopback bridge on this Mac" />
                <Step step={2} label="Runner exchanges it for a device credential" description="Kept in the macOS Keychain, never returned to the browser" />
              </Stepper>
              <Text type="supporting">
                {step >= 3 ? "The runner is online and sending heartbeats. Assign repositories after enrolment." : "Waiting for the local runner…"}
              </Text>
            </VStack>
          </LayoutContent>
        )}
        footer={(
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
              <Button
                label="Finish"
                variant="primary"
                isDisabled={step < 3}
                onClick={() => {
                  onDone(name.trim() || "This Mac");
                  onOpenChange(false);
                }}
              />
            </HStack>
          </LayoutFooter>
        )}
      />
    </Dialog>
  );
}

function ConnectorAccessDialog({ connector, onOpenChange }: { connector?: Connector; onOpenChange: (isOpen: boolean) => void }) {
  const { data, dispatch } = usePrototype();
  return (
    <Dialog isOpen={Boolean(connector)} onOpenChange={onOpenChange} width={460}>
      <Layout
        height="auto"
        defaultHasDividers
        header={<DialogHeader title={`${connector?.name ?? "Connector"} access`} subtitle="Missions in these projects can use this connector through ventneuf MCP" onOpenChange={onOpenChange} />}
        content={(
          <LayoutContent padding={4}>
            <FormLayout>
              {data.projects.map((project) => (
                <Switch
                  key={project.id}
                  label={project.name}
                  description={project.description}
                  value={Boolean(connector?.projectIds.includes(project.id))}
                  onChange={(enabled) => connector && dispatch({ type: "setConnectorProjectAccess", connectorId: connector.id, projectId: project.id, enabled })}
                />
              ))}
            </FormLayout>
          </LayoutContent>
        )}
        footer={(
          <LayoutFooter>
            <HStack gap={2} hAlign="end">
              <Button label="Done" variant="primary" onClick={() => onOpenChange(false)} />
            </HStack>
          </LayoutFooter>
        )}
      />
    </Dialog>
  );
}

function DeviceRows({ device }: { device: Device }) {
  const { data, dispatch, clock } = usePrototype();
  const owner = memberById(data, device.ownerId);
  const detail = [
    device.platform,
    `runner ${device.runnerVersion}`,
    device.orca ? `Orca ${device.orca.version} ${device.orca.isRunning ? "running" : "stopped"}` : "Orca not installed",
    owner ? `enrolled by ${owner.name}` : undefined,
  ].filter(Boolean).join(" · ");

  return (
    <VStack gap={1}>
      <HStack gap={2} vAlign="center" paddingBlock={1}>
        <StatusDot variant={device.isOnline ? "success" : "neutral"} label={device.isOnline ? "Online" : "Offline"} />
        <Text weight="semibold">{device.name}</Text>
        <StackItem size="fill">
          <Text type="supporting" maxLines={1}>{detail}</Text>
        </StackItem>
        <Text type="supporting">
          {device.isOnline ? "Heartbeat " : "Last seen "}
          <Timestamp value={device.lastSeenAt} format="time" />
        </Text>
        <MoreMenu
          label={`${device.name} options`}
          size="sm"
          items={[
            { label: "Reinstall runner service", isDisabled: true },
            { type: "divider" },
            { label: "Revoke device credential", variant: "destructive", onClick: () => dispatch({ type: "revokeDevice", deviceId: device.id, at: clock() }) },
          ]}
        />
      </HStack>
      {device.repositories.length > 0 ? (
        <List density="compact" hasDividers>
          {device.repositories.map((assignment) => {
            const repository = data.repositories.find((entry) => entry.id === assignment.repositoryId);
            const project = repository ? data.projects.find((entry) => entry.id === repository.projectId) : undefined;
            return (
              <ListItem
                key={assignment.repositoryId}
                label={<Text type="code">{repository?.name ?? assignment.repositoryId}</Text>}
                description={project ? `${project.name} · ${repository?.defaultBranch}` : undefined}
                startContent={<Icon icon={CodeBracketIcon} color="secondary" />}
                endContent={(
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    {capabilityLabels.map((capability) => (
                      <Switch
                        key={capability.id}
                        label={capability.label}
                        size="sm"
                        value={assignment.capabilities[capability.id]}
                        isDisabled={!device.isOnline}
                        disabledMessage="Bring the runner online to change capabilities"
                        onChange={(enabled) => dispatch({
                          type: "setDeviceCapability",
                          deviceId: device.id,
                          repositoryId: assignment.repositoryId,
                          capability: capability.id,
                          enabled,
                        })}
                      />
                    ))}
                  </HStack>
                )}
              />
            );
          })}
        </List>
      ) : <Text type="supporting">No repository assigned. Register one from the runner configuration on this Mac.</Text>}
    </VStack>
  );
}

export function DevicesScreen() {
  const { data, dispatch, clock } = usePrototype();
  const { isMobile, openNavigation } = useShell();
  const [isConnectOpen, setConnectOpen] = useState(false);
  const [accessConnector, setAccessConnector] = useState<Connector>();
  const activeDevices = data.devices.filter((device) => !device.isRevoked);
  const revokedDevices = data.devices.filter((device) => device.isRevoked);
  const liveAccessConnector = accessConnector ? data.connectors.find((entry) => entry.id === accessConnector.id) : undefined;

  return (
    <>
      <Layout
        height="fill"
        header={(
          <LayoutHeader hasDivider padding={3}>
            <HStack gap={3} vAlign="center">
              {isMobile ? (
                <IconButton
                  label="Back to conversations"
                  tooltip="Conversations"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon="chevronLeft" />}
                  onClick={openNavigation}
                />
              ) : null}
              <Icon icon={ComputerDesktopIcon} color="secondary" />
              <StackItem size="fill">
                <VStack gap={0}>
                  <Heading level={4} accessibilityLevel={1}>Devices and connections</Heading>
                  <Text type="supporting" maxLines={1}>Enrolled Macs, repository capabilities, and providers connected once for every mission.</Text>
                </VStack>
              </StackItem>
              <Button label="Connect this Mac" size="sm" variant="primary" onClick={() => setConnectOpen(true)} />
            </HStack>
          </LayoutHeader>
        )}
        content={(
          <LayoutContent padding={0} label="Devices and connections">
            <VStack gap={6} padding={4}>
              <VStack gap={4}>
                <Heading level={3}>{`Devices · ${formatCount(activeDevices.length, "enrolled Mac")}`}</Heading>
                {activeDevices.map((device) => <DeviceRows device={device} key={device.id} />)}
                {revokedDevices.length > 0 ? (
                  <List density="compact" hasDividers>
                    {revokedDevices.map((device) => (
                      <ListItem
                        key={device.id}
                        label={device.name}
                        description={<>Credential revoked <Timestamp value={device.lastSeenAt} format="date_time" /> · the runner can be enrolled again</>}
                        startContent={<StatusDot variant="error" label="Revoked" />}
                      />
                    ))}
                  </List>
                ) : null}
              </VStack>
              <VStack gap={2}>
                <Heading level={3}>Connectors</Heading>
                <Text type="supporting">
                  Provider credentials stay in the control plane. Agents receive mission-scoped access through ventneuf MCP instead of installing each integration on every Mac.
                </Text>
                <List density="compact" hasDividers>
                  {data.connectors.map((connector) => {
                    const status = connectorStatus[connector.status];
                    const projects = connector.projectIds.map((projectId) => data.projects.find((project) => project.id === projectId)?.name ?? projectId);
                    return (
                      <ListItem
                        key={connector.id}
                        label={connector.name}
                        description={[
                          `${formatCount(connector.tools.length, "tool")}: ${connector.tools.join(", ")}`,
                          projects.length > 0 ? `projects: ${projects.join(", ")}` : "no project access",
                          `owner ${memberById(data, connector.ownerId)?.name ?? "unknown"}`,
                        ].join(" · ")}
                        startContent={<Icon icon={LinkIcon} color="secondary" />}
                        endContent={(
                          <HStack gap={2} vAlign="center">
                            <StatusDot variant={status.dot} label={status.label} />
                            <Text type="supporting">{status.label}</Text>
                            {connector.status === "connected" ? (
                              <Button label="Access" size="sm" variant="ghost" onClick={() => setAccessConnector(connector)} />
                            ) : (
                              <Button label="Authorise" size="sm" variant="secondary" onClick={() => dispatch({ type: "connectConnector", connectorId: connector.id, at: clock() })} />
                            )}
                          </HStack>
                        )}
                      />
                    );
                  })}
                </List>
              </VStack>
              <MetadataList title={<Heading level={3}>Hermes supervisor</Heading>} label={metadataLabel}>
                <MetadataListItem label="Identity">
                  <Text type="code">hermes-supervisor</Text>
                  {" · service principal, never a member"}
                </MetadataListItem>
                <MetadataListItem label="Capabilities">
                  <Text type="code">system:identity:read · mission:dispatch · approval:decide</Text>
                </MetadataListItem>
                <MetadataListItem label="Delegation">Signed per mission · 15 minutes by default · 20 minutes at most · at most 50 targets</MetadataListItem>
                <MetadataListItem label="Endpoint">
                  <Text type="code">ventneuf MCP · streamable HTTP</Text>
                </MetadataListItem>
              </MetadataList>
            </VStack>
          </LayoutContent>
        )}
      />
      <ConnectDeviceDialog
        isOpen={isConnectOpen}
        onOpenChange={setConnectOpen}
        onDone={(name) => dispatch({ type: "enrollDevice", deviceId: `dev-${Date.now().toString(36)}`, name, platform: "macOS 26.1 · Apple silicon", at: clock() })}
      />
      <ConnectorAccessDialog
        connector={liveAccessConnector}
        onOpenChange={(isOpen) => {
          if (!isOpen) setAccessConnector(undefined);
        }}
      />
    </>
  );
}
