import { randomBytes } from "node:crypto";
import type { Express } from "express";
import { approvalActionCategories, assertAuthorized, claudeModelAliases, isAgentExecutionSnapshot, type AgentExecutionSnapshot } from "@ventneuf/domain";
import {
  MissionApprovalConflictError,
  MissionApprovalPolicyError,
  MissionApprovalUnavailableError,
  RunnerAccessError,
  RunnerAssignmentError,
  RunnerLeaseError,
} from "@ventneuf/database";
import { z } from "zod";
import { bearerToken, type TokenVerifier } from "./authentication.js";
import { hashDeviceToken, parseDeviceCredential } from "./device-auth.js";
import { dispatchRunnerMission } from "./missions.js";
import type { ConversationRuntime } from "./runtime.js";

const repositoryId = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/);
const repository = z.object({
  id: repositoryId,
  name: z.string().trim().min(1).max(100),
  orcaReview: z.boolean().optional(),
  codexDevelopment: z.boolean().optional(),
  codexModels: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/)).min(1).max(20).optional(),
  claudeDevelopment: z.boolean().optional(),
  claudeModels: z.array(z.enum(claudeModelAliases)).min(1).max(claudeModelAliases.length).optional(),
  github: z.object({
    id: z.string().regex(/^[0-9]+$/).optional(),
    owner: z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,38})$/),
    name: z.string().regex(/^[a-z0-9._-]{1,100}$/),
  }).strict().optional(),
}).strict();
const executionHarnesses = z.object({
  codex: z.object({ models: z.array(z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,99}$/)).min(1).max(20).optional() }).strict().optional(),
  claude: z.object({ models: z.array(z.enum(claudeModelAliases)).min(1).max(claudeModelAliases.length) }).strict().optional(),
}).strict();
const lease = z.object({ owner: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const report = z.object({
  owner: z.string().uuid(), token: z.string().regex(/^[a-f0-9]{64}$/), eventId: z.string().uuid(),
  kind: z.enum(["progress", "completed", "failed"]), content: z.string().trim().min(1).max(16_000),
  snapshot: z.custom<AgentExecutionSnapshot>(isAgentExecutionSnapshot).optional(),
}).strict();
const approvalRequest = z.object({
  owner: z.string().uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  requestId: z.string().uuid(),
  action: z.object({
    category: z.enum(approvalActionCategories),
    target: z.string().trim().min(1).max(500),
    argumentsDigest: z.string().regex(/^[a-f0-9]{64}$/),
    summary: z.string().trim().min(1).max(500),
    expectedEffect: z.string().trim().min(1).max(1_000),
  }).strict(),
  reason: z.string().trim().min(1).max(2_000),
  evidence: z.record(z.string().min(1).max(100), z.unknown()).refine(
    (value) => JSON.stringify(value).length <= 16_000,
    "Approval evidence is too large.",
  ),
  resume: z.object({
    adapter: z.enum(["codex", "claude"]),
    sessionId: z.string().trim().min(1).max(256).regex(/^[a-zA-Z0-9._:-]+$/),
  }).strict(),
}).strict();

export function registerRunnerRoutes(app: Express, verifier: TokenVerifier, runtime?: ConversationRuntime) {
  app.post("/api/missions/runner", async (request, response, next) => {
    try {
      const token = bearerToken(request);
      const context = token ? await verifier.verify(token) : undefined;
      if (!context) return void response.status(401).json({ error: "unauthorized" });
      if (context.principalType !== "user") return void response.status(403).json({ error: "forbidden" });
      try { assertAuthorized(context, "mission:create"); }
      catch { return void response.status(403).json({ error: "forbidden" }); }
      if (!runtime) return void response.status(503).json({ error: "runtime_unavailable" });
      const input = z.object({ deviceId: z.string().uuid(), repositoryId,
        adapter: z.enum(["repository-check", "orca-review"]).default("repository-check"),
      }).strict().parse(request.body);
      response.status(202).json(await dispatchRunnerMission(context, runtime, {
        ...input,
        objective: `${input.adapter === "orca-review" ? "Review" : "Check"} registered repository ${input.repositoryId} in read-only mode.`,
      }));
    } catch (error) {
      if (error instanceof z.ZodError) return void response.status(400).json({ error: "invalid_request" });
      if (error instanceof RunnerAssignmentError) return void response.status(404).json({ error: "repository_unavailable" });
      next(error);
    }
  });

  app.post("/api/runner/missions/:missionId/approvals", async (request, response, next) => {
    try {
      if (!runtime) return void response.status(503).json({ error: "runtime_unavailable" });
      const token = bearerToken(request);
      const parsed = token ? parseDeviceCredential(token) : undefined;
      if (!token || !parsed) return void response.status(401).json({ error: "unauthorized" });
      const missionId = z.string().uuid().parse(request.params.missionId);
      const input = approvalRequest.parse(request.body);
      let result = await runtime.approvals.requestFromRunner(
        { ...parsed, credentialHash: hashDeviceToken(token) },
        { ...input, missionId, tokenHash: hashDeviceToken(input.token) },
      );
      if (result.reviewMission) {
        try {
          await runtime.queue.publish(
            { organizationId: parsed.organizationId, missionId: result.reviewMission.id },
            result.reviewMission.conversationId,
          );
        } catch {
          const escalated = await runtime.approvals.escalateUnresolved(
            parsed.organizationId,
            result.reviewMission.id,
            "approval_review_dispatch_failed",
          );
          if (escalated) result = { approval: escalated, created: result.created };
        }
      }
      response.status(result.approval.status === "approved" ? 200 : 202).json(result);
    } catch (error) {
      if (error instanceof z.ZodError) return void response.status(400).json({ error: "invalid_request" });
      if (error instanceof RunnerAccessError) return void response.status(401).json({ error: "unauthorized" });
      if (error instanceof MissionApprovalPolicyError) return void response.status(403).json({ error: "approval_forbidden" });
      if (error instanceof MissionApprovalConflictError) return void response.status(409).json({ error: "approval_conflict" });
      if (error instanceof MissionApprovalUnavailableError) return void response.status(409).json({ error: "approval_unavailable" });
      next(error);
    }
  });

  for (const operation of ["repositories", "claim", "report", "renew", "inspect", "execution"] as const) {
    const path = operation === "report" || operation === "renew" || operation === "inspect" || operation === "execution" ? `/api/runner/missions/:missionId/${operation}`
      : operation === "claim" ? "/api/runner/missions/claim" : "/api/runner/repositories";
    app.post(path, async (request, response, next) => {
      try {
        if (!runtime) return void response.status(503).json({ error: "runtime_unavailable" });
        const token = bearerToken(request);
        const parsed = token ? parseDeviceCredential(token) : undefined;
        if (!token || !parsed) return void response.status(401).json({ error: "unauthorized" });
        const scope = { ...parsed, credentialHash: hashDeviceToken(token) };
        response.setHeader("cache-control", "no-store");
        if (operation === "repositories") {
          const input = z.object({ repositories: z.array(repository).max(100), harnesses: executionHarnesses.optional() }).strict().parse(request.body);
          if (new Set(input.repositories.map(({ id }) => id)).size !== input.repositories.length) {
            return void response.status(400).json({ error: "duplicate_repository" });
          }
          const legacyCodex = input.repositories.some(repository => repository.codexDevelopment);
          const legacyClaudeModels = [...new Set(input.repositories.flatMap(repository => repository.claudeDevelopment ? repository.claudeModels ?? [] : []))];
          const legacyCodexModels = [...new Set(input.repositories.flatMap(repository => repository.codexDevelopment ? repository.codexModels ?? [] : []))];
          const harnesses = input.harnesses ?? {
            ...(legacyCodex ? { codex: { ...(legacyCodexModels.length ? { models: legacyCodexModels } : {}) } } : {}),
            ...(legacyClaudeModels.length ? { claude: { models: legacyClaudeModels } } : {}),
          };
          await runtime.runnerMissions.register(scope, input.repositories.map(({ id, name, orcaReview, github }) => ({
            id, name, ...(orcaReview ? { orcaReview } : {}), ...(github ? { github } : {}),
          })), harnesses);
          response.json({ status: "registered" });
        } else if (operation === "claim") {
          const input = z.object({ owner: z.string().uuid() }).strict().parse(request.body);
          const leaseToken = randomBytes(32).toString("hex");
          const mission = await runtime.runnerMissions.claim(scope, input.owner, hashDeviceToken(leaseToken));
          response.json({ mission: mission ? { ...mission, leaseToken } : null });
        } else if (operation === "inspect") {
          const missionId = z.string().uuid().parse(("missionId" in request.params ? request.params.missionId : undefined));
          response.json(await runtime.runnerMissions.inspect(scope, missionId) ?? {});
        } else if (operation === "execution") {
          const input = lease.extend({ snapshot: z.custom<AgentExecutionSnapshot>(isAgentExecutionSnapshot) }).parse(request.body);
          const missionId = z.string().uuid().parse(("missionId" in request.params ? request.params.missionId : undefined));
          response.json(await runtime.runnerMissions.execution(scope, {
            missionId, owner: input.owner, tokenHash: hashDeviceToken(input.token), snapshot: input.snapshot,
          }));
        } else if (operation === "renew") {
          const input = lease.parse(request.body);
          const missionId = z.string().uuid().parse(("missionId" in request.params ? request.params.missionId : undefined));
          response.json(await runtime.runnerMissions.renew(scope, { missionId, owner: input.owner, tokenHash: hashDeviceToken(input.token) }));
        } else {
          const input = report.parse(request.body);
          const missionId = z.string().uuid().parse(("missionId" in request.params ? request.params.missionId : undefined));
          const result = await runtime.runnerMissions.report(scope, {
            ...input, missionId, tokenHash: hashDeviceToken(input.token),
          });
          response.json(result);
        }
      } catch (error) {
        if (error instanceof z.ZodError) return void response.status(400).json({ error: "invalid_request" });
        if (error instanceof RunnerAccessError) return void response.status(401).json({ error: "unauthorized" });
        if (error instanceof RunnerLeaseError) return void response.status(409).json({ error: "lease_unavailable" });
        next(error);
      }
    });
  }
}
