import assert from "node:assert/strict";
import test from "node:test";
import { workspaceNavigation } from "../lib/workspace-navigation";
import type { WorkspaceSnapshot } from "../lib/workspace";

test("project navigation leads with General and selects a single destination", () => {
  const ownership = { ownerMemberId: "owner", recipients: [], canManage: true, isOwner: true, createdAt: "", updatedAt: "" };
  const snapshot: WorkspaceSnapshot = {
    currentMember: { id: "owner", name: "Owner" }, members: [],
    projects: [{ ...ownership, id: "project", name: "Project", generalConversationId: "general", context: {}, repositoryAssociations: [] }],
    conversations: [
      { ...ownership, id: "mission", title: "Implement feature", kind: "mission", projectId: "project" },
      { ...ownership, id: "general", title: "General", kind: "topic", projectId: "project", isProjectGeneral: true },
    ],
  };
  const project = workspaceNavigation("/projects/project", false, snapshot)[1].entries[0];
  assert.equal(project.isSelected, false);
  assert.deepEqual(project.children.map(({ id, kind, isSelected }) => ({ id, kind, isSelected })), [
    { id: "general", kind: "channel", isSelected: true },
    { id: "mission", kind: "mission", isSelected: false },
  ]);
  const missionHref = project.children[1].href!;
  const missionNavigation = workspaceNavigation(missionHref, false, snapshot)[1].entries[0];
  assert.equal(missionNavigation.children[0].isSelected, false);
  assert.equal(missionNavigation.children[1].isSelected, true);
  assert.equal(snapshot.conversations[0].id, "mission");
});
