import type {
  Approval,
  Conversation,
  ConversationEntry,
  Device,
  Member,
  Mission,
  Project,
  PrototypeData,
} from "./types";

export const PROTOTYPE_NOW = "2026-09-05T14:32:00.000Z";

const nowMs = new Date(PROTOTYPE_NOW).getTime();

function minutesAgo(minutes: number): string {
  return new Date(nowMs - minutes * 60_000).toISOString();
}

function minutesAhead(minutes: number): string {
  return new Date(nowMs + minutes * 60_000).toISOString();
}

const members: Member[] = [
  { id: "mem-ada", name: "Ada Lin", isCurrentUser: true },
  { id: "mem-noor", name: "Noor Haddad" },
];

const projects: Project[] = [
  {
    id: "ventneuf-os",
    name: "ventneuf-os",
    description: "Agentic workspace product and runner.",
    repositories: ["ventneuf-os", "ventneuf-infrastructure"],
    memberIds: ["mem-ada", "mem-noor"],
    channelId: "ch-ventneuf",
  },
  {
    id: "ampel",
    name: "ampel",
    description: "Traffic and incident dashboard.",
    repositories: ["ampel-web"],
    memberIds: ["mem-ada", "mem-noor"],
    channelId: "ch-ampel",
  },
  {
    id: "brandstamp",
    name: "brandstamp",
    description: "Marketing site and asset pipeline.",
    repositories: ["brandstamp-site"],
    memberIds: ["mem-ada"],
    channelId: "ch-brandstamp",
  },
];

const devices: Device[] = [
  {
    id: "dev-studio",
    name: "Studio Mac",
    platform: "macOS 26.1 · Apple M4 Max",
    isOnline: true,
    lastSeenAt: minutesAgo(0.5),
  },
  {
    id: "dev-shared",
    name: "Shared Mac mini",
    platform: "macOS 26.1 · Apple M2",
    isOnline: false,
    lastSeenAt: minutesAgo(60 * 30),
  },
];

const conversations: Conversation[] = [
  {
    id: "hermes",
    kind: "personal-main",
    title: "Hermes",
    lastActivityAt: minutesAgo(310),
    lastVisitedAt: minutesAgo(5),
    knowledgeScope: "personal",
    summary: "Your private conversation. Uses personal knowledge by default.",
  },
  {
    id: "thread-vault",
    kind: "thread",
    parentId: "hermes",
    title: "Vault conventions",
    isPinned: true,
    lastActivityAt: minutesAgo(60 * 26),
    lastVisitedAt: minutesAgo(60 * 20),
    knowledgeScope: "personal",
  },
  {
    id: "conv-runner",
    kind: "personal",
    title: "Runner distribution",
    lastActivityAt: minutesAgo(140),
    knowledgeScope: "personal",
  },
  {
    id: "conv-week",
    kind: "personal",
    title: "Week 37 planning",
    lastActivityAt: minutesAgo(60 * 5),
    knowledgeScope: "personal",
  },
  {
    id: "conv-quick",
    kind: "temporary",
    title: "Quick question",
    lastActivityAt: minutesAgo(22),
    knowledgeScope: "none",
  },
  {
    id: "conv-onboarding",
    kind: "personal",
    title: "Device onboarding notes",
    lastActivityAt: minutesAgo(60 * 30),
    knowledgeScope: "personal",
  },
  {
    id: "conv-digest",
    kind: "personal",
    title: "Sentry digest format",
    lastActivityAt: minutesAgo(60 * 50),
    knowledgeScope: "personal",
  },
  {
    id: "conv-retro",
    kind: "personal",
    title: "Q2 retro follow-ups",
    lastActivityAt: minutesAgo(60 * 24 * 12),
    knowledgeScope: "personal",
  },
  {
    id: "ch-ventneuf",
    kind: "project-channel",
    projectId: "ventneuf-os",
    title: "ventneuf-os",
    lastActivityAt: minutesAgo(36),
    lastVisitedAt: minutesAgo(30),
    knowledgeScope: "project",
    summary: "Shared channel. Uses ventneuf-os project knowledge.",
  },
  {
    id: "thread-retention",
    kind: "thread",
    parentId: "ch-ventneuf",
    projectId: "ventneuf-os",
    title: "Worktree retention",
    lastActivityAt: minutesAgo(2),
    lastVisitedAt: minutesAgo(1),
    knowledgeScope: "project",
  },
  {
    id: "thread-expiry",
    kind: "thread",
    parentId: "ch-ventneuf",
    projectId: "ventneuf-os",
    title: "Approval expiry flake",
    lastActivityAt: minutesAgo(95),
    lastVisitedAt: minutesAgo(80),
    knowledgeScope: "project",
  },
  {
    id: "thread-cleanup",
    kind: "thread",
    parentId: "ch-ventneuf",
    projectId: "ventneuf-os",
    title: "Runner cleanup audit",
    lastActivityAt: minutesAgo(190),
    lastVisitedAt: minutesAgo(170),
    knowledgeScope: "project",
  },
  {
    id: "thread-connectors",
    kind: "thread",
    parentId: "ch-ventneuf",
    projectId: "ventneuf-os",
    title: "Connector registry design",
    lastActivityAt: minutesAgo(60 * 24 * 3),
    lastVisitedAt: minutesAgo(60 * 24 * 3),
    knowledgeScope: "project",
  },
  {
    id: "ch-ampel",
    kind: "project-channel",
    projectId: "ampel",
    title: "ampel",
    lastActivityAt: minutesAgo(48),
    knowledgeScope: "project",
    summary: "Shared channel. Uses ampel project knowledge.",
  },
  {
    id: "thread-sentry",
    kind: "thread",
    parentId: "ch-ampel",
    projectId: "ampel",
    title: "Sentry noise triage",
    lastActivityAt: minutesAgo(1),
    lastVisitedAt: minutesAgo(12),
    knowledgeScope: "project",
  },
  {
    id: "ch-brandstamp",
    kind: "project-channel",
    projectId: "brandstamp",
    title: "brandstamp",
    lastActivityAt: minutesAgo(60 * 24 * 6),
    knowledgeScope: "project",
    summary: "Shared channel. Uses brandstamp project knowledge.",
  },
];

const missions: Mission[] = [
  {
    id: "m-retention",
    conversationId: "thread-retention",
    title: "Bind worktree and terminal retention to mission state",
    objective:
      "Retain Orca terminals and worktrees while a mission is running or awaiting approval. Remove clean worktrees automatically after completion or cancellation, keep failed missions for a 24-hour diagnostic window, and refuse to delete undeclared local changes. Add tests and open a pull request.",
    status: "waiting_for_approval",
    agent: "codex",
    model: "gpt-5-codex",
    deviceId: "dev-studio",
    repository: "ventneuf-os",
    branch: "feat/mission-retention",
    baseBranch: "main",
    worktree: "~/…/runner/worktrees/ventneuf-dev-m-retention",
    initiatedById: "mem-ada",
    dispatchedBy: "hermes",
    startedAt: minutesAgo(34),
    attempt: 1,
    currentStep: "Waiting for your decision on the real cleanup run",
    summary:
      "Retention rules and cleanup rotation are implemented and unit-tested. Codex wants to validate the cleanup command against real retained worktrees before opening the pull request.",
    authority: {
      permitted: [
        "Read repository",
        "Edit owned worktree",
        "Run npm scripts",
        "Run tests",
        "Commit and push mission branch",
        "Open pull request",
      ],
      requiresApproval: ["Add dependencies", "Write outside worktree", "Network access", "Delete local data"],
      forbidden: ["Merge", "Deploy", "Change infrastructure"],
      expiresAt: minutesAhead(86),
      budgetMinutes: 120,
    },
    usage: { inputTokens: 412_800, outputTokens: 38_400, costUsd: 3.12 },
    steps: [
      {
        id: "s1",
        kind: "hermes",
        label: "Hermes dispatched the mission",
        detail: "Selected Codex on Studio Mac with a 120-minute development authority.",
        status: "completed",
        startedAt: minutesAgo(34),
        durationMs: 1_800,
      },
      {
        id: "s2",
        kind: "git",
        label: "Prepared worktree",
        detail: "feat/mission-retention from main at ae6ca43",
        status: "completed",
        startedAt: minutesAgo(33),
        durationMs: 6_400,
      },
      {
        id: "s3",
        kind: "read",
        label: "Read runner cleanup and mission lifecycle code",
        detail: "apps/runner/src/orca · packages/domain/src/missions",
        status: "completed",
        startedAt: minutesAgo(32),
        durationMs: 48_000,
      },
      {
        id: "s4",
        kind: "approval",
        label: "Approval: remove stale review worktree during setup",
        detail: "Approved by Hermes within delegated cleanup scope",
        status: "completed",
        startedAt: minutesAgo(27),
        durationMs: 9_000,
      },
      {
        id: "s5",
        kind: "edit",
        label: "Added retention policy module",
        detail: "apps/runner/src/orca/retention.ts",
        status: "completed",
        startedAt: minutesAgo(25),
        durationMs: 92_000,
        additions: 118,
        deletions: 0,
      },
      {
        id: "s6",
        kind: "approval",
        label: "Approval: add fs-extra dependency",
        detail: "Rejected by Ada Lin · continued with node:fs/promises",
        status: "completed",
        startedAt: minutesAgo(20),
        durationMs: 120_000,
      },
      {
        id: "s7",
        kind: "edit",
        label: "Rewired cleanup rotation to the retention policy",
        detail: "apps/runner/src/orca/cleanup.ts",
        status: "completed",
        startedAt: minutesAgo(17),
        durationMs: 140_000,
        additions: 64,
        deletions: 41,
      },
      {
        id: "s8",
        kind: "test",
        label: "npm test --workspace @ventneuf/runner",
        detail: "31 tests · 1 failure on first run, fixed",
        status: "completed",
        startedAt: minutesAgo(12),
        durationMs: 38_000,
        output:
          "▶ retention\n  ✔ keeps running missions (2.1ms)\n  ✔ keeps missions waiting for approval (0.4ms)\n  ✖ removes clean cancelled worktrees (1.9ms)\n    AssertionError: expected 'retain' to equal 'remove'\n\nℹ tests 31\nℹ pass 30\nℹ fail 1",
      },
      {
        id: "s9",
        kind: "test",
        label: "npm test --workspace @ventneuf/runner",
        detail: "31 tests · all passing",
        status: "completed",
        startedAt: minutesAgo(9),
        durationMs: 36_000,
        output: "ℹ tests 31\nℹ pass 31\nℹ fail 0",
      },
      {
        id: "s10",
        kind: "command",
        label: "npm run typecheck",
        detail: "All workspaces",
        status: "completed",
        startedAt: minutesAgo(7),
        durationMs: 41_000,
      },
      {
        id: "s11",
        kind: "approval",
        label: "Approval: run cleanup against retained worktrees on Studio Mac",
        detail: "Escalated by Hermes · awaiting Ada Lin",
        status: "running",
        startedAt: minutesAgo(3),
      },
      {
        id: "s12",
        kind: "git",
        label: "Push branch and open pull request",
        status: "pending",
        startedAt: minutesAgo(0),
      },
    ],
    files: [
      {
        path: "apps/runner/src/orca/retention.ts",
        status: "added",
        additions: 118,
        deletions: 0,
        diff: `--- /dev/null
+++ b/apps/runner/src/orca/retention.ts
@@ -0,0 +1,24 @@
+import type { MissionStatus } from "@ventneuf/domain";
+
+export type RetentionDecision = "retain" | "remove" | "refuse";
+
+export interface WorktreeState {
+  status: MissionStatus;
+  isClean: boolean;
+  endedAt?: Date;
+}
+
+const DIAGNOSTIC_WINDOW_MS = 24 * 60 * 60 * 1000;
+
+export function decideRetention(state: WorktreeState, now: Date): RetentionDecision {
+  if (state.status === "running" || state.status === "waiting_for_approval") return "retain";
+  if (!state.isClean) return "refuse";
+  if (state.status === "failed") {
+    const endedAt = state.endedAt?.getTime() ?? now.getTime();
+    return now.getTime() - endedAt >= DIAGNOSTIC_WINDOW_MS ? "remove" : "retain";
+  }
+  return "remove";
+}`,
      },
      {
        path: "apps/runner/src/orca/cleanup.ts",
        status: "modified",
        additions: 64,
        deletions: 41,
        diff: `--- a/apps/runner/src/orca/cleanup.ts
+++ b/apps/runner/src/orca/cleanup.ts
@@ -12,18 +12,21 @@ import { listRetainedMissions } from "./records";
-const RETENTION_HOURS = 24;
+import { decideRetention } from "./retention";

-export async function cleanupMissions(records: MissionRecord[]) {
-  for (const record of records) {
-    if (record.status === "completed") {
-      await removeWorktree(record.worktree);
-    }
-  }
+export async function cleanupMissions(records: MissionRecord[], now = new Date()) {
+  const rotated = rotate(records, now);
+  const results = await Promise.all(rotated.map(async (record) => {
+    const decision = decideRetention(await inspect(record), now);
+    if (decision === "remove") await removeWorktree(record.worktree);
+    return { id: record.id, decision };
+  }));
+  return results;
 }`,
      },
      {
        path: "apps/runner/test/retention.test.ts",
        status: "added",
        additions: 86,
        deletions: 0,
        diff: `--- /dev/null
+++ b/apps/runner/test/retention.test.ts
@@ -0,0 +1,18 @@
+import assert from "node:assert/strict";
+import test from "node:test";
+import { decideRetention } from "../src/orca/retention";
+
+const now = new Date("2026-09-05T14:00:00.000Z");
+
+test("keeps running missions", () => {
+  assert.equal(decideRetention({ status: "running", isClean: true }, now), "retain");
+});
+
+test("removes clean cancelled worktrees", () => {
+  assert.equal(decideRetention({ status: "cancelled", isClean: true }, now), "remove");
+});
+
+test("refuses to delete undeclared local changes", () => {
+  assert.equal(decideRetention({ status: "completed", isClean: false }, now), "refuse");
+});`,
      },
      {
        path: "packages/domain/src/missions/terminal-states.ts",
        status: "modified",
        additions: 9,
        deletions: 2,
        diff: `--- a/packages/domain/src/missions/terminal-states.ts
+++ b/packages/domain/src/missions/terminal-states.ts
@@ -1,4 +1,11 @@
-export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
+export const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
+export const RESUMABLE_STATUSES = ["running", "waiting_for_approval"] as const;
+
+export function isResumable(status: string): boolean {
+  return (RESUMABLE_STATUSES as readonly string[]).includes(status);
+}`,
      },
      {
        path: "docs/architecture/mission-autonomy.md",
        status: "modified",
        additions: 6,
        deletions: 3,
        diff: `--- a/docs/architecture/mission-autonomy.md
+++ b/docs/architecture/mission-autonomy.md
@@ -58,3 +58,6 @@
-Terminal and worktree retention must follow durable mission state.
+Terminal and worktree retention follows durable mission state. The runner
+retains resources for running and approval-waiting missions, removes clean
+worktrees at completion or cancellation, and keeps failures for 24 hours.`,
      },
    ],
    terminal: {
      sessionId: "term_4f1c9a2e",
      lines: [
        { id: "t1", kind: "notice", text: "ventneuf.os runner · mission m-retention · worktree ventneuf-dev-m-retention" },
        { id: "t2", kind: "command", text: "$ npm test --workspace @ventneuf/runner" },
        { id: "t3", kind: "output", text: "▶ retention" },
        { id: "t4", kind: "output", text: "  ✔ keeps running missions (2.1ms)" },
        { id: "t5", kind: "output", text: "  ✔ keeps missions waiting for approval (0.4ms)" },
        { id: "t6", kind: "error", text: "  ✖ removes clean cancelled worktrees (1.9ms)" },
        { id: "t7", kind: "error", text: "    AssertionError: expected 'retain' to equal 'remove'" },
        { id: "t8", kind: "output", text: "ℹ tests 31 · pass 30 · fail 1" },
        { id: "t9", kind: "command", text: "$ npm test --workspace @ventneuf/runner" },
        { id: "t10", kind: "output", text: "ℹ tests 31 · pass 31 · fail 0" },
        { id: "t11", kind: "command", text: "$ npm run typecheck" },
        { id: "t12", kind: "output", text: "> tsc --noEmit (6 workspaces)" },
        { id: "t13", kind: "output", text: "Typecheck passed in 41.2s" },
        { id: "t14", kind: "command", text: "$ node apps/runner/dist/cli.js cleanup --dry-run" },
        { id: "t15", kind: "output", text: "3 clean worktrees would be removed · 1 dirty worktree refused" },
        { id: "t16", kind: "notice", text: "Approval requested: run cleanup without --dry-run. Waiting for a decision…" },
      ],
    },
    checks: [
      { id: "c1", label: "npm run typecheck", status: "passed", detail: "6 workspaces", durationMs: 41_200 },
      { id: "c2", label: "npm test --workspace @ventneuf/runner", status: "passed", detail: "31 tests, 0 skipped", durationMs: 36_000 },
      { id: "c3", label: "npm run build", status: "pending", detail: "Runs before the pull request is opened" },
    ],
    screenshots: [],
    artifacts: [
      { id: "a1", kind: "report", label: "cleanup-dry-run.json", size: "2.1 KB" },
      { id: "a2", kind: "log", label: "runner-test-run-2.log", size: "18 KB" },
    ],
  },
  {
    id: "m-sentry",
    conversationId: "thread-sentry",
    title: "Reduce Sentry noise on the ampel incident board",
    objective:
      "Identify the three noisiest Sentry issues for ampel-web, silence the ones caused by client-side extensions, fix the incident board hydration warning, and verify the board renders without console errors.",
    status: "running",
    agent: "claude",
    model: "claude-sonnet-5",
    deviceId: "dev-studio",
    repository: "ampel-web",
    branch: "fix/incident-board-noise",
    baseBranch: "main",
    worktree: "~/…/runner/worktrees/ampel-dev-m-sentry",
    initiatedById: "mem-noor",
    dispatchedBy: "hermes",
    startedAt: minutesAgo(19),
    attempt: 1,
    currentStep: "Verifying the incident board in the browser",
    summary:
      "The hydration warning is fixed locally. Claude is capturing browser evidence while Hermes reviews the Sentry connector read.",
    authority: {
      permitted: ["Read repository", "Edit owned worktree", "Run tests", "Browser automation", "Push mission branch", "Open pull request"],
      requiresApproval: ["Connector reads", "Connector writes", "Network access"],
      forbidden: ["Merge", "Deploy"],
      expiresAt: minutesAhead(101),
      budgetMinutes: 120,
    },
    usage: { inputTokens: 188_000, outputTokens: 21_500, costUsd: 1.46 },
    steps: [
      {
        id: "s1",
        kind: "hermes",
        label: "Hermes dispatched the mission",
        detail: "Selected Claude on Studio Mac with browser automation enabled.",
        status: "completed",
        startedAt: minutesAgo(19),
        durationMs: 1_400,
      },
      {
        id: "s2",
        kind: "read",
        label: "Read incident board components",
        detail: "src/app/incidents · src/components/board",
        status: "completed",
        startedAt: minutesAgo(18),
        durationMs: 31_000,
      },
      {
        id: "s3",
        kind: "edit",
        label: "Fixed hydration mismatch in IncidentClock",
        detail: "Render the relative time after mount",
        status: "completed",
        startedAt: minutesAgo(14),
        durationMs: 64_000,
        additions: 14,
        deletions: 6,
      },
      {
        id: "s4",
        kind: "test",
        label: "npm test",
        detail: "58 tests · all passing",
        status: "completed",
        startedAt: minutesAgo(11),
        durationMs: 22_000,
      },
      {
        id: "s5",
        kind: "browser",
        label: "Captured incident board before and after",
        detail: "Desktop and mobile viewports",
        status: "completed",
        startedAt: minutesAgo(6),
        durationMs: 18_000,
      },
      {
        id: "s6",
        kind: "approval",
        label: "Approval: read Sentry issues through ventneuf MCP",
        detail: "Routed to Hermes",
        status: "running",
        startedAt: minutesAgo(1),
      },
      {
        id: "s7",
        kind: "browser",
        label: "Verify console is clean on the incident board",
        status: "running",
        startedAt: minutesAgo(0.5),
      },
    ],
    files: [
      {
        path: "src/components/board/IncidentClock.tsx",
        status: "modified",
        additions: 14,
        deletions: 6,
        diff: `--- a/src/components/board/IncidentClock.tsx
+++ b/src/components/board/IncidentClock.tsx
@@ -4,9 +4,17 @@ import { formatRelative } from "../../lib/time";
-export function IncidentClock({ startedAt }: { startedAt: string }) {
-  return <span>{formatRelative(startedAt, new Date())}</span>;
+export function IncidentClock({ startedAt }: { startedAt: string }) {
+  const [label, setLabel] = useState<string>();
+
+  useEffect(() => {
+    setLabel(formatRelative(startedAt, new Date()));
+  }, [startedAt]);
+
+  return <span suppressHydrationWarning>{label ?? "—"}</span>;
 }`,
      },
      {
        path: "src/lib/sentry-filters.ts",
        status: "added",
        additions: 22,
        deletions: 0,
        diff: `--- /dev/null
+++ b/src/lib/sentry-filters.ts
@@ -0,0 +1,9 @@
+export const ignoredErrorPatterns = [
+  /ResizeObserver loop limit exceeded/,
+  /chrome-extension:\\/\\//,
+  /Non-Error promise rejection captured/,
+];
+
+export function isIgnoredError(message: string): boolean {
+  return ignoredErrorPatterns.some((pattern) => pattern.test(message));
+}`,
      },
    ],
    terminal: {
      sessionId: "term_b81d0e77",
      lines: [
        { id: "t1", kind: "notice", text: "ventneuf.os runner · mission m-sentry · worktree ampel-dev-m-sentry" },
        { id: "t2", kind: "command", text: "$ npm test" },
        { id: "t3", kind: "output", text: "ℹ tests 58 · pass 58 · fail 0" },
        { id: "t4", kind: "command", text: "$ npm run dev -- --port 4311" },
        { id: "t5", kind: "output", text: "▲ Next.js ready on http://localhost:4311" },
        { id: "t6", kind: "notice", text: "Browser session opened · capturing /incidents at 1440×900 and 390×844" },
        { id: "t7", kind: "output", text: "Saved incidents-desktop-before.png, incidents-desktop-after.png, incidents-mobile-after.png" },
        { id: "t8", kind: "notice", text: "Approval requested: connector read sentry.issues.list (ampel-web). Routed to Hermes." },
        { id: "t9", kind: "output", text: "Continuing with console verification while the connector read is decided…" },
      ],
    },
    checks: [
      { id: "c1", label: "npm test", status: "passed", detail: "58 tests", durationMs: 22_000 },
      { id: "c2", label: "Console errors on /incidents", status: "running", detail: "Checking desktop and mobile" },
      { id: "c3", label: "Lighthouse accessibility", status: "pending", detail: "Runs after the console check" },
    ],
    screenshots: [
      {
        id: "sc1",
        label: "incidents-desktop-before.png",
        caption: "Hydration warning visible in the board header",
        viewport: "1440 × 900",
        capturedAt: minutesAgo(6),
      },
      {
        id: "sc2",
        label: "incidents-desktop-after.png",
        caption: "Board renders with the clock filled after mount",
        viewport: "1440 × 900",
        capturedAt: minutesAgo(5),
      },
      {
        id: "sc3",
        label: "incidents-mobile-after.png",
        caption: "Mobile layout after the fix",
        viewport: "390 × 844",
        capturedAt: minutesAgo(5),
      },
    ],
    artifacts: [{ id: "a1", kind: "log", label: "browser-console.log", size: "4 KB" }],
  },
  {
    id: "m-review",
    conversationId: "hermes",
    title: "Read-only review of ventneuf-os at 3402f4b",
    objective:
      "Review the committed source of ventneuf-os at 3402f4b for authorization gaps, cancellation races, and unbounded streams. Report findings only; do not change files.",
    status: "completed",
    agent: "codex",
    model: "gpt-5-codex",
    deviceId: "dev-studio",
    repository: "ventneuf-os",
    baseBranch: "main",
    worktree: "~/…/runner/worktrees/ventneuf-review-m-review",
    initiatedById: "mem-ada",
    dispatchedBy: "member",
    startedAt: minutesAgo(318),
    endedAt: minutesAgo(313),
    attempt: 1,
    summary: "Reviewed 101 selected files and returned three findings to the conversation. The clean review worktree was removed automatically.",
    authority: {
      permitted: ["Read repository snapshot"],
      requiresApproval: [],
      forbidden: ["Edit files", "Network access", "Run commands"],
      expiresAt: minutesAgo(308),
      budgetMinutes: 5,
    },
    usage: { inputTokens: 296_000, outputTokens: 6_200, costUsd: 0.81 },
    steps: [
      {
        id: "s1",
        kind: "read",
        label: "Snapshot of 101 committed files",
        detail: "Bounded Git blobs at 3402f4b",
        status: "completed",
        startedAt: minutesAgo(318),
        durationMs: 4_100,
      },
      {
        id: "s2",
        kind: "command",
        label: "Sandbox isolation probe",
        detail: "Writes, sibling reads, and loopback network denied",
        status: "completed",
        startedAt: minutesAgo(318),
        durationMs: 2_300,
      },
      {
        id: "s3",
        kind: "read",
        label: "Reviewed control-plane and MCP modules",
        status: "completed",
        startedAt: minutesAgo(317),
        durationMs: 240_000,
      },
      {
        id: "s4",
        kind: "hermes",
        label: "Hermes summarised three findings in the conversation",
        status: "completed",
        startedAt: minutesAgo(313),
        durationMs: 8_000,
      },
    ],
    files: [],
    terminal: {
      sessionId: "term_799456f7",
      lines: [
        { id: "t1", kind: "notice", text: "ventneuf.os runner · read-only review · snapshot 3402f4b" },
        { id: "t2", kind: "command", text: "$ codex exec --sandbox read-only --profile ventneuf-review" },
        { id: "t3", kind: "output", text: "Isolation probe passed (write, sibling read, loopback denied)" },
        { id: "t4", kind: "output", text: "Reviewing 101 files…" },
        { id: "t5", kind: "output", text: "3 findings written to review.md" },
        { id: "t6", kind: "notice", text: "Supervisor exited with code 0 · worktree removed" },
      ],
    },
    checks: [{ id: "c1", label: "Isolation probe", status: "passed", detail: "Sandbox rejected every escape attempt", durationMs: 2_300 }],
    screenshots: [],
    artifacts: [{ id: "a1", kind: "report", label: "review.md", size: "9 KB" }],
  },
  {
    id: "m-expiry",
    conversationId: "thread-expiry",
    title: "Stabilise the approval expiry test",
    objective:
      "Make the control-plane approval expiry test deterministic under fenced leases. Reproduce the flake, fix the root cause, and keep the suite green across three consecutive runs.",
    status: "failed",
    agent: "codex",
    model: "gpt-5-codex",
    deviceId: "dev-studio",
    repository: "ventneuf-os",
    branch: "fix/approval-expiry-flake",
    baseBranch: "main",
    worktree: "~/…/runner/worktrees/ventneuf-dev-m-expiry",
    initiatedById: "mem-ada",
    dispatchedBy: "hermes",
    startedAt: minutesAgo(150),
    endedAt: minutesAgo(96),
    attempt: 3,
    summary:
      "Three attempts could not make the expiry test pass consistently. The lease renewal clock and the approval expiry clock disagree by up to 400 ms on the disposable database. The worktree is retained for diagnosis.",
    authority: {
      permitted: ["Read repository", "Edit owned worktree", "Run tests", "Push mission branch"],
      requiresApproval: ["Start containers", "Network access"],
      forbidden: ["Merge", "Deploy"],
      expiresAt: minutesAgo(30),
      budgetMinutes: 120,
    },
    usage: { inputTokens: 1_020_000, outputTokens: 74_000, costUsd: 7.9 },
    failure: {
      reason: "Tests still failing after 3 attempts",
      detail: "approval expiry · expected status 'expired' but received 'waiting' (2 of 89 tests failed)",
      retainedUntil: minutesAhead(60 * 22),
    },
    steps: [
      {
        id: "s1",
        kind: "hermes",
        label: "Hermes dispatched the mission",
        status: "completed",
        startedAt: minutesAgo(150),
        durationMs: 1_500,
      },
      {
        id: "s2",
        kind: "approval",
        label: "Approval: start a disposable PostgreSQL container",
        detail: "Approved by Ada Lin",
        status: "completed",
        startedAt: minutesAgo(148),
        durationMs: 95_000,
      },
      {
        id: "s3",
        kind: "test",
        label: "Reproduced the flake",
        detail: "Fails 3 of 10 runs",
        status: "completed",
        startedAt: minutesAgo(140),
        durationMs: 300_000,
      },
      {
        id: "s4",
        kind: "edit",
        label: "Used the database clock for expiry comparisons",
        detail: "apps/control-plane/src/approvals/expiry.ts",
        status: "completed",
        startedAt: minutesAgo(128),
        durationMs: 180_000,
        additions: 31,
        deletions: 12,
      },
      {
        id: "s5",
        kind: "test",
        label: "npm test --workspace @ventneuf/control-plane",
        detail: "Attempt 3 · 2 failures",
        status: "failed",
        startedAt: minutesAgo(100),
        durationMs: 210_000,
        output:
          "▶ approvals\n  ✖ expires a pending approval after its deadline (412ms)\n    AssertionError: expected 'expired' but received 'waiting'\n  ✖ resumes with a fresh lease after expiry (388ms)\n\nℹ tests 89\nℹ pass 87\nℹ fail 2",
      },
      {
        id: "s6",
        kind: "hermes",
        label: "Hermes stopped the mission after the third failed attempt",
        detail: "Worktree retained for 24 hours",
        status: "failed",
        startedAt: minutesAgo(96),
        durationMs: 2_000,
      },
    ],
    files: [
      {
        path: "apps/control-plane/src/approvals/expiry.ts",
        status: "modified",
        additions: 31,
        deletions: 12,
        diff: `--- a/apps/control-plane/src/approvals/expiry.ts
+++ b/apps/control-plane/src/approvals/expiry.ts
@@ -20,8 +20,11 @@ export async function expirePendingApprovals(db: Database) {
-  const now = new Date();
-  return db.approvals.expireBefore(now);
+  const { now } = await db.clock();
+  const expired = await db.approvals.expireBefore(now);
+  await db.missions.clearLeases(expired.map((approval) => approval.missionId));
+  return expired;
 }`,
      },
      {
        path: "apps/control-plane/test/approval-expiry.test.ts",
        status: "modified",
        additions: 18,
        deletions: 4,
        diff: `--- a/apps/control-plane/test/approval-expiry.test.ts
+++ b/apps/control-plane/test/approval-expiry.test.ts
@@ -31,4 +31,8 @@ test("expires a pending approval after its deadline", async () => {
-  await sleep(500);
+  await advanceDatabaseClock(db, 500);
   const approval = await db.approvals.get(id);
   assert.equal(approval.status, "expired");`,
      },
    ],
    terminal: {
      sessionId: "term_2c77e9b0",
      lines: [
        { id: "t1", kind: "notice", text: "ventneuf.os runner · mission m-expiry · attempt 3" },
        { id: "t2", kind: "command", text: "$ npm test --workspace @ventneuf/control-plane" },
        { id: "t3", kind: "error", text: "✖ expires a pending approval after its deadline (412ms)" },
        { id: "t4", kind: "error", text: "  AssertionError: expected 'expired' but received 'waiting'" },
        { id: "t5", kind: "error", text: "✖ resumes with a fresh lease after expiry (388ms)" },
        { id: "t6", kind: "output", text: "ℹ tests 89 · pass 87 · fail 2" },
        { id: "t7", kind: "notice", text: "Hermes: third failed attempt. Stopping the mission and retaining the worktree until tomorrow 12:56." },
      ],
    },
    checks: [
      { id: "c1", label: "npm run typecheck", status: "passed", detail: "6 workspaces", durationMs: 39_000 },
      { id: "c2", label: "npm test --workspace @ventneuf/control-plane", status: "failed", detail: "2 of 89 tests failed", durationMs: 210_000 },
    ],
    screenshots: [],
    artifacts: [
      { id: "a1", kind: "log", label: "control-plane-test-attempt-3.log", size: "61 KB" },
      { id: "a2", kind: "report", label: "flake-analysis.md", size: "3 KB" },
    ],
  },
  {
    id: "m-cleanup",
    conversationId: "thread-cleanup",
    title: "Audit idle Orca resources on Studio Mac",
    objective:
      "List idle Orca terminals and stale worktrees for ventneuf-os, classify them by owning mission, and propose which ones are safe to remove.",
    status: "cancelled",
    agent: "claude",
    model: "claude-sonnet-5",
    deviceId: "dev-studio",
    repository: "ventneuf-os",
    baseBranch: "main",
    worktree: "~/…/runner/worktrees/ventneuf-dev-m-cleanup",
    initiatedById: "mem-ada",
    dispatchedBy: "hermes",
    startedAt: minutesAgo(200),
    endedAt: minutesAgo(190),
    attempt: 1,
    summary: "Cancelled by Ada Lin after the retention mission was scoped to solve the root cause. The clean worktree was removed automatically.",
    authority: {
      permitted: ["Read repository", "List local Orca resources"],
      requiresApproval: ["Delete local data"],
      forbidden: ["Edit files", "Network access"],
      expiresAt: minutesAgo(140),
      budgetMinutes: 60,
    },
    usage: { inputTokens: 61_000, outputTokens: 4_300, costUsd: 0.34 },
    cancellation: {
      byId: "mem-ada",
      reason: "Superseded by the worktree retention mission.",
      at: minutesAgo(190),
    },
    steps: [
      {
        id: "s1",
        kind: "hermes",
        label: "Hermes dispatched the mission",
        status: "completed",
        startedAt: minutesAgo(200),
        durationMs: 1_200,
      },
      {
        id: "s2",
        kind: "command",
        label: "orca terminal list --json",
        detail: "13 idle shells found",
        status: "completed",
        startedAt: minutesAgo(199),
        durationMs: 3_100,
      },
      {
        id: "s3",
        kind: "command",
        label: "git worktree list --porcelain",
        detail: "8 merged product worktrees",
        status: "completed",
        startedAt: minutesAgo(198),
        durationMs: 900,
      },
      {
        id: "s4",
        kind: "hermes",
        label: "Cancelled by Ada Lin",
        detail: "Clean worktree removed",
        status: "skipped",
        startedAt: minutesAgo(190),
        durationMs: 1_100,
      },
    ],
    files: [],
    terminal: {
      sessionId: "term_a01f33d9",
      lines: [
        { id: "t1", kind: "notice", text: "ventneuf.os runner · mission m-cleanup" },
        { id: "t2", kind: "command", text: "$ orca terminal list --json" },
        { id: "t3", kind: "output", text: "13 terminals · 13 idle · oldest 4d" },
        { id: "t4", kind: "command", text: "$ git worktree list --porcelain" },
        { id: "t5", kind: "output", text: "8 worktrees · 8 clean" },
        { id: "t6", kind: "notice", text: "Cancellation received from Ada Lin. Closing owned processes and removing the clean worktree." },
      ],
    },
    checks: [],
    screenshots: [],
    artifacts: [{ id: "a1", kind: "report", label: "orca-audit.json", size: "5 KB" }],
  },
];

const approvals: Approval[] = [
  {
    id: "ap-worktree",
    missionId: "m-retention",
    state: "approved",
    requestedAt: minutesAgo(27),
    expiresAt: minutesAgo(12),
    operation: "Remove stale review worktree",
    category: "filesystem",
    target: "~/…/runner/worktrees/ventneuf-review-f741e84e",
    reason: "The retention tests need an empty worktree directory. This clean worktree belongs to a review mission that completed four days ago.",
    expectedEffect: "Deletes one clean worktree outside the mission sandbox. No uncommitted files are affected.",
    digest: "sha256:5f2a…c91e",
    hermesNote: "Clean worktree owned by a completed review mission. Removal is within the delegated cleanup scope for ventneuf-os.",
    decision: {
      by: "hermes",
      outcome: "approved",
      note: "Approved within delegated cleanup scope.",
      authority: "Hermes discretionary mandate · cleanup of completed missions",
      at: minutesAgo(26.8),
    },
    resumedAt: minutesAgo(26.7),
    sessionRef: "codex:thread_01J9…RETN",
  },
  {
    id: "ap-dependency",
    missionId: "m-retention",
    state: "rejected",
    requestedAt: minutesAgo(20),
    expiresAt: minutesAgo(5),
    operation: "Add dependency fs-extra@11.3.0 to @ventneuf/runner",
    category: "dependency",
    target: "apps/runner/package.json · package-lock.json",
    reason: "fs-extra offers a recursive remove with retries, which simplifies the cleanup rotation.",
    expectedEffect: "Adds one runtime dependency and changes the lockfile.",
    digest: "sha256:8b17…04aa",
    hermesNote: "Dependency additions are routed to the initiating member by the ventneuf-os project policy.",
    decision: {
      by: "member",
      outcome: "rejected",
      note: "Use node:fs/promises. The runner must stay dependency-free.",
      authority: "Ada Lin · project owner",
      at: minutesAgo(18),
    },
    resumedAt: minutesAgo(17.9),
    sessionRef: "codex:thread_01J9…RETN",
  },
  {
    id: "ap-real-cleanup",
    missionId: "m-retention",
    state: "escalated",
    requestedAt: minutesAgo(3),
    expiresAt: minutesAhead(27),
    operation: "Run cleanup against retained worktrees on Studio Mac",
    category: "filesystem",
    target: "~/…/runner/worktrees (4 retained missions)",
    reason: "The dry run matches expectations. A real run validates the retention policy end to end before the pull request is opened.",
    expectedEffect: "Removes 3 clean worktrees from completed and cancelled missions. Refuses the dirty worktree from the failed expiry mission.",
    digest: "sha256:c4d0…77be",
    hermesNote: "Deleting real mission data outside the sandbox is a mandatory human gate for ventneuf-os. I cannot approve it, so I am asking you.",
    sessionRef: "codex:thread_01J9…RETN",
  },
  {
    id: "ap-sentry-read",
    missionId: "m-sentry",
    state: "requested",
    requestedAt: minutesAgo(1),
    expiresAt: minutesAhead(29),
    operation: "Read Sentry issues for ampel-web through ventneuf MCP",
    category: "connector",
    target: "sentry.issues.list · project ampel-web · last 7 days",
    reason: "Confirm which of the noisy issues are produced by browser extensions before adding them to the ignore list.",
    expectedEffect: "One read-only connector call. No Sentry data is modified.",
    digest: "sha256:12e9…b3f0",
    sessionRef: "claude:session_7c2f…AMPL",
  },
  {
    id: "ap-postgres",
    missionId: "m-expiry",
    state: "approved",
    requestedAt: minutesAgo(148),
    expiresAt: minutesAgo(118),
    operation: "Start a disposable PostgreSQL 18 container",
    category: "process",
    target: "docker run postgres:18-alpine · port 54329",
    reason: "The expiry tests require a real database with advisory locks.",
    expectedEffect: "Starts one container on Studio Mac for the duration of the mission. It is removed at the end.",
    digest: "sha256:aa41…9d2c",
    hermesNote: "Starting containers is routed to the initiating member by the ventneuf-os runner policy.",
    decision: {
      by: "member",
      outcome: "approved",
      note: "Fine for this mission only.",
      authority: "Ada Lin · project owner",
      at: minutesAgo(146.5),
    },
    resumedAt: minutesAgo(146.4),
    sessionRef: "codex:thread_01J9…EXPR",
  },
];

const entries: Record<string, ConversationEntry[]> = {
  hermes: [
    {
      id: "h1",
      kind: "message",
      role: "user",
      content: "Recap what changed in ventneuf-os this week and save it as today's daily note.",
      createdAt: minutesAgo(330),
    },
    {
      id: "h2",
      kind: "message",
      role: "hermes",
      content:
        "Here is the week in ventneuf-os:\n\n- **Autonomous Codex missions** landed in PR #36 with a two-hour mission authority and native approval capture.\n- **Durable approvals** (PR #35) route requests to Hermes, to you, or deny them by policy.\n- **KMS-signed delegation** (PR #34) removed the last static Hermes credential.\n\nI saved this as `Daily/2026-09-05.md` in your personal vault.",
      createdAt: minutesAgo(328),
      timing: { totalMs: 6_400, model: "hermes-supervisor", tokens: 1_820 },
    },
    {
      id: "h3",
      kind: "system",
      icon: "knowledge",
      content: "Saved to personal knowledge · Daily/2026-09-05.md",
      createdAt: minutesAgo(328),
    },
    {
      id: "h4",
      kind: "message",
      role: "user",
      content: "Run a read-only review of ventneuf-os at 3402f4b before I merge the approval workflow.",
      createdAt: minutesAgo(319),
    },
    {
      id: "h5",
      kind: "message",
      role: "hermes",
      content: "Starting a read-only review on Studio Mac. Codex gets a five-minute snapshot of the committed tree and cannot write or reach the network.",
      createdAt: minutesAgo(318.5),
      timing: { totalMs: 2_100, model: "hermes-supervisor", tokens: 640 },
    },
    { id: "h6", kind: "mission", missionId: "m-review", createdAt: minutesAgo(318) },
    {
      id: "h7",
      kind: "message",
      role: "hermes",
      content:
        "The review finished in 4 min 51 s with three findings:\n\n1. **Remote MCP `hermes.ask`** forwards a caller-provided context ID without checking conversation ownership.\n2. **`setMissionRunning`** can overwrite a cancellation that lands between the worker read and the status update.\n3. **Runs event stream** has no cancellation signal and can stay open past the polling window.\n\nAll three are source-level defects, not reproductions. Want me to open a corrective mission?",
      createdAt: minutesAgo(313),
      timing: { totalMs: 8_900, model: "hermes-supervisor", tokens: 2_310 },
    },
    {
      id: "h8",
      kind: "message",
      role: "user",
      content: "Not yet. Track them in the project channel and I'll pick the order.",
      createdAt: minutesAgo(310),
    },
  ],
  "thread-vault": [
    {
      id: "v1",
      kind: "system",
      icon: "thread",
      content: "Thread started from a message in Hermes",
      createdAt: minutesAgo(60 * 26),
    },
    {
      id: "v2",
      kind: "message",
      role: "user",
      content: "Which vault conventions should Hermes follow when it writes daily notes?",
      createdAt: minutesAgo(60 * 26),
    },
    {
      id: "v3",
      kind: "message",
      role: "hermes",
      content:
        "From your personal vault:\n\n- Daily notes live under `Daily/YYYY-MM-DD.md` with a `## Decisions` section.\n- Project decisions go to the shared vault, never to a daily note.\n- Temporary conversations never write to either vault.\n\nI will show the destination before every write.",
      createdAt: minutesAgo(60 * 26 - 1),
      timing: { totalMs: 3_800, model: "hermes-supervisor", tokens: 910 },
    },
  ],
  "conv-runner": [
    {
      id: "r1",
      kind: "message",
      role: "user",
      content: "How should we distribute the runner to a second Mac without copying the Keychain identity?",
      createdAt: minutesAgo(142),
    },
    {
      id: "r2",
      kind: "message",
      role: "hermes",
      content:
        "Enrol the second Mac as its own device. Each device gets a distinct credential; the shared Mac mini and your Studio Mac must never share an identity. The signed desktop distribution is a later milestone, so for now the installer script plus a fresh enrolment from the web app is the supported path.",
      createdAt: minutesAgo(140),
      timing: { totalMs: 4_100, model: "hermes-supervisor", tokens: 780 },
    },
  ],
  "conv-week": [
    {
      id: "w1",
      kind: "message",
      role: "user",
      content: "Draft next week's priorities from the open threads.",
      createdAt: minutesAgo(60 * 5 + 4),
    },
    {
      id: "w2",
      kind: "message",
      role: "hermes",
      content:
        "1. Land worktree retention and close the cleanup gap.\n2. Fix the approval expiry flake before enabling unattended missions.\n3. Add the Claude adapter to the same lifecycle contract.\n4. Start the central connector registry with a Sentry read.",
      createdAt: minutesAgo(60 * 5),
      timing: { totalMs: 5_200, model: "hermes-supervisor", tokens: 1_040 },
    },
  ],
  "conv-quick": [
    {
      id: "q1",
      kind: "message",
      role: "user",
      content: "What does the `--dense` flag do in the Astryx CLI?",
      createdAt: minutesAgo(23),
    },
    {
      id: "q2",
      kind: "message",
      role: "hermes",
      content: "It prints the same reference in a compressed, token-efficient format. Nothing from this temporary conversation is written to your vault.",
      createdAt: minutesAgo(22),
      timing: { totalMs: 1_900, model: "hermes-supervisor", tokens: 310 },
    },
  ],
  "conv-onboarding": [
    {
      id: "o1",
      kind: "message",
      role: "user",
      content: "Summarise the device onboarding steps for a new teammate.",
      createdAt: minutesAgo(60 * 30 + 3),
    },
    {
      id: "o2",
      kind: "message",
      role: "hermes",
      content: "Sign in, click **Connect this Mac**, and let the runner exchange the ten-minute enrolment token. The credential stays in the Keychain and never reaches the browser.",
      createdAt: minutesAgo(60 * 30),
      timing: { totalMs: 2_700, model: "hermes-supervisor", tokens: 520 },
    },
  ],
  "conv-digest": [
    {
      id: "d1",
      kind: "message",
      role: "user",
      content: "Propose a format for a daily Sentry digest.",
      createdAt: minutesAgo(60 * 50 + 2),
    },
    {
      id: "d2",
      kind: "message",
      role: "hermes",
      content: "A table per project with issue, events in 24 h, first seen, and a suggested owner. I can produce it once the Sentry connector is available through ventneuf MCP.",
      createdAt: minutesAgo(60 * 50),
      timing: { totalMs: 3_100, model: "hermes-supervisor", tokens: 600 },
    },
  ],
  "conv-retro": [
    {
      id: "re1",
      kind: "message",
      role: "user",
      content: "List the Q2 retro follow-ups that are still open.",
      createdAt: minutesAgo(60 * 24 * 12 + 1),
    },
    {
      id: "re2",
      kind: "message",
      role: "hermes",
      content: "Two remain: signed desktop distribution and usage attribution per mission.",
      createdAt: minutesAgo(60 * 24 * 12),
      timing: { totalMs: 2_400, model: "hermes-supervisor", tokens: 410 },
    },
  ],
  "ch-ventneuf": [
    {
      id: "c1",
      kind: "message",
      role: "user",
      authorId: "mem-noor",
      content: "The Orca audit found thirteen idle shells and eight stale worktrees. We keep cleaning this by hand.",
      createdAt: minutesAgo(205),
    },
    {
      id: "c2",
      kind: "message",
      role: "user",
      authorId: "mem-ada",
      content: "Agreed, that is a lifecycle gap. Hermes, audit what is there first, then we decide.",
      createdAt: minutesAgo(203),
    },
    {
      id: "c3",
      kind: "system",
      icon: "thread",
      content: "Thread started · Runner cleanup audit",
      createdAt: minutesAgo(201),
    },
    {
      id: "c4",
      kind: "message",
      role: "user",
      authorId: "mem-ada",
      content: "Change of plan: let's fix the root cause. Retention should follow mission state instead of manual cleanup.",
      createdAt: minutesAgo(192),
    },
    {
      id: "c5",
      kind: "message",
      role: "hermes",
      content: "I cancelled the audit and scoped a development mission for Codex: retain while running or awaiting approval, remove clean worktrees at completion or cancellation, keep failures for 24 hours, and refuse undeclared local changes. It runs in its own thread.",
      createdAt: minutesAgo(191),
      timing: { totalMs: 5_600, model: "hermes-supervisor", tokens: 1_120 },
    },
    {
      id: "c7",
      kind: "message",
      role: "user",
      authorId: "mem-noor",
      content: "The expiry flake is still blocking unattended missions. Anything new there?",
      createdAt: minutesAgo(38),
    },
    {
      id: "c8",
      kind: "message",
      role: "hermes",
      content: "The third attempt failed with the same 400 ms clock disagreement. I stopped the mission and kept the worktree. The next step needs a decision on using the database clock everywhere, which I have summarised in the thread.",
      createdAt: minutesAgo(36),
      timing: { totalMs: 4_400, model: "hermes-supervisor", tokens: 860 },
    },
    {
      id: "c6",
      kind: "system",
      icon: "thread",
      content: "Thread started · Worktree retention",
      createdAt: minutesAgo(35),
    },
  ],
  "thread-retention": [
    {
      id: "tr1",
      kind: "system",
      icon: "thread",
      content: "Thread started from a message in #ventneuf-os",
      createdAt: minutesAgo(35),
    },
    {
      id: "tr2",
      kind: "message",
      role: "hermes",
      content:
        "**Mission scope**\n\nBind terminal and worktree retention to durable mission state. Codex works in an owned worktree on Studio Mac with a 120-minute authority: repository reads, worktree edits, tests, pushing the mission branch, and opening a pull request are pre-authorised. Dependencies, writes outside the worktree, network access, and deleting local data need an approval.",
      createdAt: minutesAgo(34.5),
      timing: { totalMs: 3_900, model: "hermes-supervisor", tokens: 940 },
    },
    { id: "tr3", kind: "mission", missionId: "m-retention", createdAt: minutesAgo(34) },
    { id: "tr4", kind: "approval", approvalId: "ap-worktree", createdAt: minutesAgo(27) },
    { id: "tr5", kind: "approval", approvalId: "ap-dependency", createdAt: minutesAgo(20) },
    {
      id: "tr6",
      kind: "message",
      role: "hermes",
      content: "Codex continued without the dependency and rewired the cleanup rotation with `node:fs/promises`. Tests and typecheck pass.",
      createdAt: minutesAgo(7),
      timing: { totalMs: 2_600, model: "hermes-supervisor", tokens: 480 },
    },
    { id: "tr7", kind: "approval", approvalId: "ap-real-cleanup", createdAt: minutesAgo(3) },
  ],
  "thread-expiry": [
    {
      id: "te1",
      kind: "system",
      icon: "thread",
      content: "Thread started from a message in #ventneuf-os",
      createdAt: minutesAgo(151),
    },
    { id: "te2", kind: "mission", missionId: "m-expiry", createdAt: minutesAgo(150) },
    { id: "te3", kind: "approval", approvalId: "ap-postgres", createdAt: minutesAgo(148) },
    {
      id: "te4",
      kind: "message",
      role: "hermes",
      content:
        "The mission failed after three attempts. Root cause so far: the lease renewal clock uses the worker's wall clock while approval expiry compares against the database clock, and they disagree by up to 400 ms on the disposable database.\n\nOptions:\n\n1. Use the database clock for both comparisons.\n2. Add a tolerance window to the expiry check.\n\nI recommend option 1. The worktree is retained until tomorrow 12:56 so the diff is not lost.",
      createdAt: minutesAgo(95),
      timing: { totalMs: 7_100, model: "hermes-supervisor", tokens: 1_480 },
    },
  ],
  "thread-cleanup": [
    {
      id: "tc1",
      kind: "system",
      icon: "thread",
      content: "Thread started from a message in #ventneuf-os",
      createdAt: minutesAgo(201),
    },
    { id: "tc2", kind: "mission", missionId: "m-cleanup", createdAt: minutesAgo(200) },
    {
      id: "tc3",
      kind: "message",
      role: "user",
      authorId: "mem-ada",
      content: "Stop this one, we are fixing the root cause instead.",
      createdAt: minutesAgo(190.5),
    },
    {
      id: "tc4",
      kind: "system",
      icon: "mission",
      content: "Mission cancelled by Ada Lin · clean worktree removed",
      createdAt: minutesAgo(190),
    },
  ],
  "thread-connectors": [
    {
      id: "tn1",
      kind: "message",
      role: "user",
      authorId: "mem-ada",
      content: "Sketch the connector registry: server-side credentials, mission-scoped access, selected tool catalogue.",
      createdAt: minutesAgo(60 * 24 * 3 + 5),
    },
    {
      id: "tn2",
      kind: "message",
      role: "hermes",
      content: "Draft saved to project knowledge under `Architecture/Connector registry.md`. It keeps provider secrets in the control plane and exposes a curated catalogue per mission.",
      createdAt: minutesAgo(60 * 24 * 3),
      timing: { totalMs: 6_300, model: "hermes-supervisor", tokens: 1_300 },
    },
  ],
  "ch-ampel": [
    {
      id: "am1",
      kind: "message",
      role: "user",
      authorId: "mem-noor",
      content: "The incident board is drowning in Sentry noise again, and the hydration warning is back on the header clock.",
      createdAt: minutesAgo(50),
    },
    {
      id: "am2",
      kind: "message",
      role: "hermes",
      content: "I scoped a mission for Claude: silence extension-generated errors, fix the clock hydration, and verify the board in the browser. Connector reads go through ventneuf MCP and I will review them.",
      createdAt: minutesAgo(48),
      timing: { totalMs: 4_800, model: "hermes-supervisor", tokens: 990 },
    },
    {
      id: "am3",
      kind: "system",
      icon: "thread",
      content: "Thread started · Sentry noise triage",
      createdAt: minutesAgo(20),
    },
  ],
  "thread-sentry": [
    {
      id: "ts1",
      kind: "system",
      icon: "thread",
      content: "Thread started from a message in #ampel",
      createdAt: minutesAgo(20),
    },
    { id: "ts2", kind: "mission", missionId: "m-sentry", createdAt: minutesAgo(19) },
    {
      id: "ts3",
      kind: "message",
      role: "hermes",
      content: "Claude fixed the hydration mismatch and captured the board before and after. Browser evidence is attached to the mission.",
      createdAt: minutesAgo(4),
      timing: { totalMs: 2_900, model: "hermes-supervisor", tokens: 520 },
    },
    { id: "ts4", kind: "approval", approvalId: "ap-sentry-read", createdAt: minutesAgo(1) },
  ],
  "ch-brandstamp": [
    {
      id: "b1",
      kind: "message",
      role: "user",
      authorId: "mem-ada",
      content: "Nothing planned here until the asset pipeline is back on the roadmap.",
      createdAt: minutesAgo(60 * 24 * 6),
    },
  ],
};

export const prototypeData: PrototypeData = {
  now: PROTOTYPE_NOW,
  members,
  projects,
  devices,
  conversations,
  entries,
  missions,
  approvals,
};
