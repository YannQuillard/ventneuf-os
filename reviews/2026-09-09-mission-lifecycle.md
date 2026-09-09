# Mission lifecycle review — 2026-09-09

The review follows a project request from the browser through Hermes, delegated dispatch, runner execution, approval resumption, durable completion, and cleanup. It also covers access revocation, cancellation, duplicate requests, lease expiry, native harness configuration, and deployment compatibility.

## Findings addressed

| Priority | Failure | Correction and evidence |
| --- | --- | --- |
| P1 | A current delegation UUID submitted through a cached `delegationToken` field was treated as a malformed signed token. Production diagnostics confirmed this exact mismatch. | Resolve UUIDs in either field against the active parent mission. MCP tests cover both field names and reject expired, foreign, missing, and mismatched authority. No validation boundary is relaxed. |
| P1 | Approval reviews still required Hermes to reproduce a long signed token, leaving push and PR creation vulnerable to the same failure as dispatch. | Register approval claims on the review mission and expose a short approval delegation ID. Bind lookup to the service, organization, member, conversation, review, approval and lifetime. Preserve the reference on native run resumption. Legacy field names remain supported. |
| P1 | The development adapter deleted its result and worktree before the runner's completion report was acknowledged. Exhausted transport retries could then cause a reclaimed mission to start without its completed local state. | Retain the completed result and worktree. A reclaimed execution returns the same result without launching another terminal. Maintenance cleans only after observing the server's terminal state; dirty worktrees remain retained. A real local Git worktree regression covers this ordering. |
| P1 | One transient lease-renewal transport failure immediately aborted a running agent despite remaining valid lease time. | Retry transport failures within the last confirmed lease. Explicit rejection, invalid renewal, authority expiry and lease expiry still stop execution. Tests cover recovery, continuous outage, and immediate rejection. |
| P2 | Separate Quote and Reply to Hermes controls split one user intent across two different actions; quoting could fail to address Hermes. | Use one reply arrow that quotes the assistant, adds the mention in project chat, preserves the draft and focuses the composer. Browser regression covers the interaction. |

## Boundary coverage

| Stage | Review and validation |
| --- | --- |
| Project chat and form | Current conversation access and initiating-member ownership are checked in the database. Answers are accepted once transactionally. Browser tests cover defaults, edits, retries, reload, and other-member behavior. |
| Hermes processing | Durable queue envelope, stored mission state, native run identity, scoped memory, and cancellation fence are maintained independently of request handlers. Existing tests cover native status timeouts and resumption. |
| Dispatch | Current registered authority, target capabilities, project association, repository, member ownership and request idempotency are checked before creating a child mission. |
| Runner claim | Device credentials, exclusive claims, current project authority, lease lifetime, model choices and mission authority are validated. Existing database tests cover revocation and stale claims. |
| Native execution | Both adapters use their native harness and an isolated worktree. Installed Claude CLI options were checked against its local help. Adapter/supervisor tests cover process control, retained state, execution events, and approvals. |
| Approvals | The exact requested operation remains bound to its approval and native session. The lifecycle test pauses, obtains an authorized Hermes decision, and reclaims the same child mission with that decision. Existing tests cover human decisions, expiry, policy revalidation and cancellation. |
| Completion and cleanup | Result persistence is idempotent by event ID. A deliberately lost HTTP acknowledgement does not duplicate the result. Local state survives until durable completion is observed. |

## End-to-end regression

`apps/control-plane/test/mission-lifecycle.integration.test.ts` exercises the actual control-plane HTTP API, MCP tools, PostgreSQL repositories, queue processing, and runner HTTP client:

1. Mention Hermes in project General with project memory available.
2. Create and answer a prefilled execution-plan form.
3. Dispatch once using the legacy field name, then repeat the dispatch request to verify idempotency.
4. Claim the selected Claude/Opus/high mission and pause for PR creation approval.
5. Resolve the approval using a stored delegation reference and reclaim the same mission.
6. Persist completion, lose the first acknowledgement, and retry with the same event ID.
7. Verify one child mission, one final result, and completed status.

Hermes responses and the native adapter in this integration test are deterministic substitutes. The test does not access a real model subscription, create a GitHub PR, or execute user repository code. Separate adapter tests exercise local Git worktree retention and replay without relaunch.

## Remaining validation boundary

A production mission on the member's runner must still confirm live model authentication, native agent behavior, credential-brokered GitHub push/PR creation, and the final result in the actual project. Local and CI regressions establish the application lifecycle; they do not constitute a completed production mission. The application currently treats a reported PR URL as an agent result, not independent proof that GitHub accepted the requested changes.

No production mission was dispatched during this review. Deployment requires the merged control-plane image and runner release. Terraform apply remains manual.
