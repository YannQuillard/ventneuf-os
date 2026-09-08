import assert from "node:assert/strict";
import test from "node:test";
import { missionHarnessOptions, type WorkspaceDevice, type WorkspaceProject } from "../lib/workspace";

test("mission harness choices reflect project runner subscriptions", () => {
  const project = {
    id: "project", name: "Project", context: {}, ownerMemberId: "member", recipients: [], canManage: true,
    isOwner: true, createdAt: "", updatedAt: "", repositoryAssociations: [
      { id: "association", deviceId: "device", repositoryId: "repository" },
    ],
  } satisfies WorkspaceProject;
  const devices = [{ id: "device", name: "Mac", repositories: [{ id: "repository", name: "Repository",
    codexDevelopment: true, codexModels: ["gpt-codex"], claudeDevelopment: true, claudeModels: ["sonnet", "opus"] }] }] satisfies WorkspaceDevice[];

  assert.deepEqual(missionHarnessOptions(project, devices), [
    { value: "codex:gpt-codex", label: "Codex · gpt-codex", provider: "codex", model: "gpt-codex",
      subagentModels: [{ value: "inherit", label: "Inherit lead model" }, { value: "gpt-codex", label: "gpt-codex" }] },
    { value: "claude:opus", label: "Claude Code · Opus", provider: "claude", model: "opus",
      subagentModels: [{ value: "inherit", label: "Inherit lead model" }, { value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }] },
    { value: "claude:sonnet", label: "Claude Code · Sonnet", provider: "claude", model: "sonnet",
      subagentModels: [{ value: "inherit", label: "Inherit lead model" }, { value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }] },
  ]);
});

test("mission harness choices exclude capabilities outside the project", () => {
  const project = { id: "project", name: "Project", context: {}, ownerMemberId: "member", recipients: [], canManage: true,
    isOwner: true, createdAt: "", updatedAt: "", repositoryAssociations: [] } satisfies WorkspaceProject;
  const devices = [{ id: "device", name: "Mac", repositories: [{ id: "repository", name: "Repository",
    codexDevelopment: true }] }] satisfies WorkspaceDevice[];
  assert.deepEqual(missionHarnessOptions(project, devices), []);
});
