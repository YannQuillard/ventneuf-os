"use client";

import { Button } from "@astryxdesign/core/Button";
import { Dialog, DialogHeader } from "@astryxdesign/core/Dialog";
import { FormLayout } from "@astryxdesign/core/FormLayout";
import { HStack, Layout, LayoutContent, LayoutFooter } from "@astryxdesign/core/Layout";
import { MultiSelector } from "@astryxdesign/core/MultiSelector";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { useEffect, useMemo, useState } from "react";
import type { MissionExecutionPreferences, MissionHarnessOption, ReasoningEffort, WorkspaceDevice, WorkspaceMember } from "../../lib/workspace";

function FormDialog({ isOpen, onOpenChange, title, subtitle, submitLabel, isSubmitting, error, onSubmit, children }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  subtitle?: string;
  submitLabel: string;
  isSubmitting: boolean;
  error?: string;
  onSubmit: () => void;
  children: React.ReactNode;
}) {
  return <Dialog isOpen={isOpen} onOpenChange={onOpenChange} purpose="form" width={520} maxHeight="calc(100dvh - 32px)">
    <Layout height="auto" defaultHasDividers
      header={<DialogHeader title={title} subtitle={subtitle} onOpenChange={onOpenChange} />}
      content={<LayoutContent padding={4} style={{ maxHeight: "calc(100dvh - 180px)" }}><FormLayout defaultOptionality="optional">{children}
        {error ? <Text type="supporting" color="primary" role="alert">{error}</Text> : null}
      </FormLayout></LayoutContent>}
      footer={<LayoutFooter><HStack gap={2} hAlign="end">
        <Button label="Cancel" variant="secondary" onClick={() => onOpenChange(false)} />
        <Button label={submitLabel} variant="primary" isLoading={isSubmitting} clickAction={onSubmit} />
      </HStack></LayoutFooter>} />
  </Dialog>;
}

export function NewConversationDialog({ isOpen, onOpenChange, onCreate }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onCreate: (title?: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (isOpen) { setTitle(""); setError(undefined); } }, [isOpen]);
  const submit = async () => {
    setSubmitting(true); setError(undefined);
    try { await onCreate(title.trim() || undefined); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the conversation."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title="New conversation"
    subtitle="A private conversation with Hermes" submitLabel="Create conversation" isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextInput label="Title" value={title} onChange={setTitle} placeholder="What do you want to discuss?" isOptional hasAutoFocus onEnter={() => void submit()} />
  </FormDialog>;
}

export function EditDisplayNameDialog({ isOpen, onOpenChange, currentName, onSave }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  currentName: string;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(currentName);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (isOpen) { setName(currentName); setError(undefined); } }, [currentName, isOpen]);
  const submit = async () => {
    if (!name.trim()) { setError("Enter a display name."); return; }
    setSubmitting(true); setError(undefined);
    try { await onSave(name.trim()); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update your display name."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title="Edit display name"
    subtitle="This name identifies you in shared projects and conversations" submitLabel="Save name"
    isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextInput label="Display name" value={name} onChange={setName} isRequired hasAutoFocus onEnter={() => void submit()} />
  </FormDialog>;
}

export function NewProjectDialog({ isOpen, onOpenChange, devices, initial, onCreate }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  devices: WorkspaceDevice[];
  initial?: { name: string; context: string; repositoryAssociations: Array<{ deviceId: string; repositoryId: string }> };
  onCreate: (input: { name: string; context?: { description: string }; repositoryAssociations: Array<{ deviceId: string; repositoryId: string }> }) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [context, setContext] = useState("");
  const [repositories, setRepositories] = useState<string[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const options = useMemo(() => devices.flatMap((device) => (device.repositories ?? []).map((repository) => ({
    value: JSON.stringify([device.id, repository.id]), label: `${repository.name} · ${device.name}`,
  }))), [devices]);
  const initialRepositoryKey = JSON.stringify(initial?.repositoryAssociations ?? []);
  useEffect(() => { if (isOpen) {
    setName(initial?.name ?? ""); setContext(initial?.context ?? "");
    const associations = JSON.parse(initialRepositoryKey) as Array<{ deviceId: string; repositoryId: string }>;
    setRepositories(associations.map(({ deviceId, repositoryId }) => JSON.stringify([deviceId, repositoryId])));
    setError(undefined);
  } }, [initial?.context, initial?.name, initialRepositoryKey, isOpen]);
  const submit = async () => {
    if (!name.trim()) { setError("Enter a project name."); return; }
    setSubmitting(true); setError(undefined);
    try {
      await onCreate({ name: name.trim(), context: context.trim() ? { description: context.trim() } : undefined,
        repositoryAssociations: repositories.map((value) => {
          const [deviceId, repositoryId] = JSON.parse(value) as [string, string];
          return { deviceId, repositoryId };
        }) });
      onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create the project."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title={initial ? "Edit project" : "New project"}
    subtitle={initial ? "Update project context and repository associations" : "Private to you until you choose recipients"}
    submitLabel={initial ? "Save project" : "Create project"} isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextInput label="Name" value={name} onChange={setName} isRequired hasAutoFocus onEnter={() => void submit()} />
    <TextArea label="Project context" value={context} onChange={setContext} rows={4} isOptional
      description="Purpose, constraints, and durable background Hermes should use for this project." />
    <MultiSelector label="Repositories" options={options} value={repositories} onChange={setRepositories}
      placeholder={options.length ? "Choose repositories" : "No registered repositories"} triggerDisplay="labels" isOptional hasClear
      hasSelectAll={options.length > 1} hasSearch={options.length > 15}
      description="Select one or more registered repositories. A repository can be reused across projects."
      isDisabled={!options.length} disabledMessage="Register a repository from Devices before associating it with a project." />
  </FormDialog>;
}

export function ShareResourceDialog({ isOpen, onOpenChange, resourceLabel, members, currentMemberId, recipients, onSave }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  resourceLabel: string;
  members: WorkspaceMember[];
  currentMemberId: string;
  recipients: WorkspaceMember[];
  onSave: (added: string[], removed: string[]) => Promise<void>;
}) {
  const [value, setValue] = useState<string[]>([]);
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const candidates = members.filter((member) => member.id !== currentMemberId);
  useEffect(() => { if (isOpen) { setValue(recipients.map(({ id }) => id)); setError(undefined); } }, [isOpen, recipients]);
  const submit = async () => {
    const current = new Set(recipients.map(({ id }) => id));
    const next = new Set(value);
    setSubmitting(true); setError(undefined);
    try { await onSave(value.filter((id) => !current.has(id)), [...current].filter((id) => !next.has(id))); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update sharing."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title={`Share ${resourceLabel}`}
    subtitle="Access applies only to this resource" submitLabel="Save access" isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <MultiSelector label="Recipients" options={candidates.map(({ id, name }) => ({ value: id, label: name }))}
      value={value} onChange={setValue} placeholder={candidates.length ? "Choose members" : "No other members available"}
      triggerDisplay="labels" hasClear isOptional isDisabled={!candidates.length}
      disabledMessage="No other organization members are available." />
    <Text type="supporting">Sharing this resource does not expose private conversations, mission threads, personal memory, or other project work.</Text>
  </FormDialog>;
}

export function NewThreadDialog({ isOpen, onOpenChange, parentTitle, onCreate }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  parentTitle: string;
  onCreate: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (isOpen) { setTitle(""); setError(undefined); } }, [isOpen]);
  const submit = async () => {
    if (!title.trim()) { setError("Enter a thread title."); return; }
    setSubmitting(true); setError(undefined);
    try { await onCreate(title.trim()); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to start the thread."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title="Start topic thread"
    subtitle={`A private branch from ${parentTitle}`} submitLabel="Start thread" isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextInput label="Thread title" value={title} onChange={setTitle} isRequired hasAutoFocus onEnter={() => void submit()} />
    <Text type="supporting">The relationship to the source conversation is preserved. The thread stays private until you share it explicitly.</Text>
  </FormDialog>;
}

export function NewMissionDialog({ isOpen, onOpenChange, projectName, initialObjective, initialTitle, harnessOptions, onCreate }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectName: string;
  initialObjective?: string;
  initialTitle?: string;
  harnessOptions: MissionHarnessOption[];
  onCreate: (input: { title: string; objective: string; execution: MissionExecutionPreferences }) => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [harnessSelection, setHarnessSelection] = useState("");
  const [subagentModels, setSubagentModels] = useState<string[]>(["inherit"]);
  const [leadReasoningEffort, setLeadReasoningEffort] = useState<ReasoningEffort>("high");
  const [subagentReasoningEffort, setSubagentReasoningEffort] = useState<ReasoningEffort>("high");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  const defaultHarnessSelection = harnessOptions[0]?.value;
  const selectedHarness = harnessOptions.find(({ value }) => value === harnessSelection);
  useEffect(() => { if (isOpen) { setTitle(initialTitle ?? ""); setObjective(initialObjective ?? "");
    setHarnessSelection(defaultHarnessSelection ?? ""); setSubagentModels(["inherit"]); setLeadReasoningEffort("high");
    setSubagentReasoningEffort("high"); setError(undefined); } }, [defaultHarnessSelection, initialObjective, initialTitle, isOpen]);
  const submit = async () => {
    if (!title.trim() || !objective.trim() || !selectedHarness || !subagentModels.length) {
      setError("Enter a mission title, request, execution harness, and at least one sub-agent model."); return;
    }
    setSubmitting(true); setError(undefined);
    try { await onCreate({ title: title.trim(), objective: objective.trim(), execution: {
      harness: { provider: selectedHarness.provider, ...(selectedHarness.model ? { model: selectedHarness.model } : {}),
        reasoningEffort: leadReasoningEffort },
      subagents: { models: subagentModels, reasoningEffort: subagentReasoningEffort },
    } }); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to start the mission."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title="New mission"
    subtitle={`A private mission thread in ${projectName}`} submitLabel="Start mission" isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextInput label="Mission title" value={title} onChange={setTitle} isRequired hasAutoFocus />
    <TextArea label="Request" value={objective} onChange={setObjective} rows={6} isRequired
      description="Describe the outcome, constraints, and relevant repositories for Hermes." />
    <Selector label="Execution harness and lead model" value={harnessSelection} onChange={value => { setHarnessSelection(value); setSubagentModels(["inherit"]); }} isRequired
      options={harnessOptions.map(({ value, label }) => ({ value, label }))} isDisabled={!harnessOptions.length}
      disabledMessage="Enable Codex or Claude Code development on a repository associated with this project."
      description="The mission runs in this native subscription; Hermes only coordinates its dispatch." />
    <Selector label="Lead agent reasoning" value={leadReasoningEffort} onChange={value => setLeadReasoningEffort(value as ReasoningEffort)} isRequired
      options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "xhigh", label: "Extra high" }, { value: "max", label: "Maximum" }]}
      description="Applied to the main Codex or Claude Code agent." />
    <MultiSelector label="Sub-agent models" value={subagentModels} onChange={setSubagentModels} isRequired triggerDisplay="labels"
      options={selectedHarness?.subagentModels ?? []} isDisabled={!selectedHarness}
      disabledMessage="Choose an execution harness first."
      description="The lead agent is instructed to use these native sub-agent models when delegation helps." />
    <Selector label="Sub-agent reasoning" value={subagentReasoningEffort} onChange={value => setSubagentReasoningEffort(value as ReasoningEffort)} isRequired
      options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "xhigh", label: "Extra high" }, { value: "max", label: "Maximum" }]}
      description="Requested for every native sub-agent spawned by the lead agent." />
    <Text type="supporting">Project members cannot discover this mission unless you explicitly share its thread.</Text>
  </FormDialog>;
}

export function AddProjectMemoryDialog({ isOpen, onOpenChange, projectName, onAdd }: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  projectName: string;
  onAdd: (entry: string) => Promise<void>;
}) {
  const [entry, setEntry] = useState("");
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { if (isOpen) { setEntry(""); setError(undefined); } }, [isOpen]);
  const submit = async () => {
    if (!entry.trim()) { setError("Enter something the project should remember."); return; }
    setSubmitting(true); setError(undefined);
    try { await onAdd(entry.trim()); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update project memory."); }
    finally { setSubmitting(false); }
  };
  return <FormDialog isOpen={isOpen} onOpenChange={onOpenChange} title="Add to project memory"
    subtitle={`Shared durable context for ${projectName}`} submitLabel="Add to memory" isSubmitting={isSubmitting} error={error} onSubmit={submit}>
    <TextArea label="Memory" value={entry} onChange={setEntry} rows={5} maxLength={4_000} isRequired hasAutoFocus
      description="Hermes and project missions receive this context. Everyone in the project can see it." />
  </FormDialog>;
}
