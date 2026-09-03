import type { Message } from "./conversations";

export interface FixtureConversation {
  id: string;
  title: string;
  kind: "recent" | "temporary";
  updatedAt: string;
  messages: Message[];
}

export const fixtureConversations: FixtureConversation[] = [
  {
    id: "auth-session-review",
    title: "Auth session review",
    kind: "recent",
    updatedAt: "2026-09-03T09:42:31Z",
    messages: [
      {
        id: "fixture-auth-session-review-1",
        role: "user",
        content: "Review the pull request that adds Cognito sessions to the web workspace before I merge it.",
        createdAt: "2026-09-03T09:31:00Z",
      },
      {
        id: "fixture-auth-session-review-2",
        role: "tool",
        content: "Read the pull request diff and the two files it touches",
        createdAt: "2026-09-03T09:31:12Z",
      },
      {
        id: "fixture-auth-session-review-3",
        role: "assistant",
        content: `The change adds a signed session cookie, a login route, and a logout route.

**What holds up**

- The session payload is signed with HMAC-SHA256 and compared with a constant-time check.
- Expiry is validated on every read, so a stale cookie cannot outlive its window.
- The verifier fails closed when the configuration is missing, which matches the security rule for production.

**What I would change**

1. The logout route clears the session cookie but leaves the access token cookie in place.
2. The redirect after login trusts a query parameter without checking that it stays on this origin.`,
        createdAt: "2026-09-03T09:32:10Z",
        metadata: { timing: { totalMs: 8400 } },
      },
      {
        id: "fixture-auth-session-review-4",
        role: "user",
        content: "Is the cookie readable from client script?",
        createdAt: "2026-09-03T09:38:44Z",
      },
      {
        id: "fixture-auth-session-review-5",
        role: "assistant",
        content: `No. Both cookies are written from the route handler with the same options:

\`\`\`ts
cookieStore.set(SESSION_COOKIE, value, {
  httpOnly: true,
  secure: true,
  sameSite: "lax",
  path: "/",
});
\`\`\`

\`httpOnly\` keeps the value out of \`document.cookie\`, and \`sameSite: "lax"\` blocks it on cross-site subrequests while still allowing the return trip from the identity provider.`,
        createdAt: "2026-09-03T09:39:20Z",
        metadata: { timing: { totalMs: 3100 } },
      },
      {
        id: "fixture-auth-session-review-6",
        role: "user",
        content: "Good. Anything blocking?",
        createdAt: "2026-09-03T09:41:05Z",
      },
      {
        id: "fixture-auth-session-review-7",
        role: "assistant",
        content: `Nothing blocking. Two follow-ups worth filing after the merge:

- Clear the access token cookie in the logout route.
- Restrict the post-login redirect to same-origin paths.

Neither one changes the merge decision, so this is ready to go.`,
        createdAt: "2026-09-03T09:42:31Z",
        metadata: { timing: { totalMs: 2600 } },
      },
    ],
  },
  {
    id: "vault-note-curation",
    title: "Vault note curation",
    kind: "recent",
    updatedAt: "2026-09-02T18:15:36Z",
    messages: [
      {
        id: "fixture-vault-note-curation-1",
        role: "user",
        content: "My vault has four notes about the runner protocol and they contradict each other. Help me curate them.",
        createdAt: "2026-09-02T17:52:00Z",
      },
      {
        id: "fixture-vault-note-curation-2",
        role: "tool",
        content: "Read 4 notes from the personal vault",
        createdAt: "2026-09-02T17:52:08Z",
      },
      {
        id: "fixture-vault-note-curation-3",
        role: "assistant",
        content: `Here is where they disagree.

| Note | Last edited | Claim |
| --- | --- | --- |
| Runner protocol.md | 12 Aug | The runner polls the control plane every 30 seconds. |
| Runner notes.md | 21 Aug | The control plane pushes work over a persistent connection. |
| Local bridge.md | 27 Aug | The bridge holds a persistent connection and the runner reads from it. |
| Device pairing.md | 30 Aug | Pairing issues a device identity separate from the human identity. |

The first three describe the same mechanism at three points in time. Only the newest one matches the code I can see. The fourth is about a different concern and should stay separate.`,
        createdAt: "2026-09-02T17:52:44Z",
        metadata: { timing: { totalMs: 11200 } },
      },
      {
        id: "fixture-vault-note-curation-4",
        role: "user",
        content: "Merge the first three into one note and keep the newest decision wherever they disagree.",
        createdAt: "2026-09-02T18:01:19Z",
      },
      {
        id: "fixture-vault-note-curation-5",
        role: "assistant",
        content: `I would write to \`Knowledge/Runners/Runner protocol.md\` with this outline:

1. Purpose and boundaries
2. Connection model, from the 27 Aug version
3. Work handoff and acknowledgement
4. Failure and reconnection
5. Superseded decisions, with the dates they were replaced

\`Device pairing.md\` stays untouched. Confirm the destination and I will write it, then archive the two older notes.`,
        createdAt: "2026-09-02T18:02:07Z",
        metadata: { timing: { totalMs: 5300 } },
      },
      {
        id: "fixture-vault-note-curation-6",
        role: "user",
        content: "Confirmed. Write it and archive the other two.",
        createdAt: "2026-09-02T18:14:02Z",
      },
      {
        id: "fixture-vault-note-curation-7",
        role: "assistant",
        content: `Done.

- Wrote \`Knowledge/Runners/Runner protocol.md\`.
- Moved \`Runner notes.md\` and \`Local bridge.md\` to \`Archive/2026-09/\`.
- Recorded both writes with their source notes and this conversation as the origin.

The superseded section keeps the polling model on record so the history is not lost.`,
        createdAt: "2026-09-02T18:15:36Z",
        metadata: { timing: { totalMs: 6900 } },
      },
    ],
  },
  {
    id: "ampel-runner-mission",
    title: "Ampel runner mission",
    kind: "recent",
    updatedAt: "2026-09-02T08:05:22Z",
    messages: [
      {
        id: "fixture-ampel-runner-mission-1",
        role: "user",
        content: "The ampel repository still fails its nightly build. Can you plan a mission to get it green again?",
        createdAt: "2026-09-02T07:41:00Z",
      },
      {
        id: "fixture-ampel-runner-mission-2",
        role: "assistant",
        content: `Here is what I would run.

- **Objective** — restore a passing nightly build on \`ampel\`.
- **Repository** — \`ventneuf/ampel\`, branch \`fix/nightly-build\`.
- **Runner** — this Mac, because the failing step needs the local toolchain.
- **Permissions** — read the repository, write one branch, open one pull request. No deployment access.
- **Budget** — 20 minutes of runner time.

The last three nightly logs all fail in the same place, so I would start by reproducing that step before changing anything.`,
        createdAt: "2026-09-02T07:41:38Z",
        metadata: { timing: { totalMs: 7400 } },
      },
      {
        id: "fixture-ampel-runner-mission-3",
        role: "user",
        content: "Keep the scope to the build. Do not touch the deployment workflow.",
        createdAt: "2026-09-02T07:48:12Z",
      },
      {
        id: "fixture-ampel-runner-mission-4",
        role: "assistant",
        content: `Scoped. The mission will only reproduce and fix this command:

\`\`\`bash
npm run build --workspace @ampel/renderer
\`\`\`

Everything under \`.github/workflows/deploy.yml\` is excluded from the writable paths, so the mission cannot change it even if the fix looks related.`,
        createdAt: "2026-09-02T07:48:51Z",
        metadata: { timing: { totalMs: 3800 } },
      },
      {
        id: "fixture-ampel-runner-mission-5",
        role: "user",
        content: "Good. Draft the mission but wait for my approval before it runs.",
        createdAt: "2026-09-02T08:03:04Z",
      },
      {
        id: "fixture-ampel-runner-mission-6",
        role: "assistant",
        content: `Drafted and held for approval.

- Nothing runs until you approve it, and the runner stays idle in the meantime.
- The draft expires in 24 hours so a stale plan cannot start against a moved branch.
- You can redirect or stop it from this thread once it starts.`,
        createdAt: "2026-09-02T08:05:22Z",
        metadata: { timing: { totalMs: 2200 } },
      },
    ],
  },
  {
    id: "idea-storm",
    title: "Idea storm",
    kind: "temporary",
    updatedAt: "2026-09-03T07:20:15Z",
    messages: [
      {
        id: "fixture-idea-storm-1",
        role: "user",
        content: "Throwaway thinking. What would this workspace feel like if the composer were the only permanent surface?",
        createdAt: "2026-09-03T07:12:00Z",
      },
      {
        id: "fixture-idea-storm-2",
        role: "assistant",
        content: `Three sketches, none of them costed.

1. **Composer as the address bar** — every destination is reached by typing, and the sidebar only records where you have been.
2. **Conversation as the canvas** — messages stay, panels open over them and close again, so nothing but the thread persists between tasks.
3. **Composer as a workbench** — the input keeps the current repository, runner, and knowledge boundary attached, and moving between conversations swaps the attachments rather than the layout.

The third one changes the least on screen and the most in behaviour.`,
        createdAt: "2026-09-03T07:12:48Z",
        metadata: { timing: { totalMs: 5100 } },
      },
      {
        id: "fixture-idea-storm-3",
        role: "user",
        content: "The third one is interesting but I am not committing to it. Keep this out of the vault.",
        createdAt: "2026-09-03T07:19:02Z",
      },
      {
        id: "fixture-idea-storm-4",
        role: "assistant",
        content: "Nothing from this conversation reaches durable knowledge. If one of these sketches turns into a decision, start it again in a persistent conversation and I will record it there.",
        createdAt: "2026-09-03T07:20:15Z",
        metadata: { timing: { totalMs: 1400 } },
      },
    ],
  },
];

export function findFixtureConversation(id: string): FixtureConversation | undefined {
  return fixtureConversations.find((conversation) => conversation.id === id);
}
