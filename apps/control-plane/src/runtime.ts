import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import {
  ConversationRuntimeRepository,
  createDatabase,
  DeviceRuntimeRepository,
  MissionApprovalRepository,
  RunnerMissionRepository,
  type Database,
} from "@ventneuf/database";
import {
  HermesRequestTimeoutError,
  HermesRunCancelledError,
  type HermesClient,
} from "./hermes.js";
import type {
  MissionApprovalDelegationGrant,
  MissionDelegationGrant,
  MissionDelegationIssuer,
} from "./mission-delegation.js";

interface DatabaseCredentials {
  username?: string;
  password?: string;
}

interface MissionEnvelope {
  organizationId: string;
  missionId: string;
}

interface MissionTiming {
  acceptedAt?: string;
  queuedAt?: string;
  workerReceivedAt?: string;
  hermesStartedAt?: string;
  hermesCompletedAt?: string;
  persistedAt?: string;
  failedAt?: string;
  queueMs?: number;
  hermesMs?: number;
  totalMs?: number;
}

function missionTiming(context: Record<string, unknown> | undefined): MissionTiming {
  const timing = context?.timing;
  return timing && typeof timing === "object" ? timing as MissionTiming : {};
}

function elapsedMs(from: string | undefined, to: Date): number | undefined {
  if (!from) return undefined;
  const value = to.getTime() - new Date(from).getTime();
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function logMission(event: string, fields: Record<string, unknown>) {
  console.info(JSON.stringify({ component: "mission-worker", event, ...fields }));
}

function messageWithDelegation(message: string, grant: MissionDelegationGrant): string {
  return [
    message,
    "",
    "<ventneuf_mission_authority>",
    `Parent mission: ${grant.claims.parentMissionId}`,
    "You may dispatch bounded runner work only through the ventneuf MCP mission.dispatch tool.",
    "Pass the delegation token below and a stable UUID requestId with every dispatch. Reuse the requestId when retrying the same dispatch.",
    `Available targets: ${JSON.stringify(grant.claims.targets)}`,
    `Delegation token: ${grant.token}`,
    `Delegation expires at: ${grant.claims.expiresAt}`,
    "Do not quote or return the delegation token in your response.",
    "</ventneuf_mission_authority>",
  ].join("\n");
}

function messageWithApprovalDelegation(message: string, grant: MissionApprovalDelegationGrant): string {
  return [
    message,
    "",
    "<ventneuf_approval_authority>",
    `Approval request: ${grant.claims.approvalId}`,
    "Decide only this approval through the ventneuf MCP approval.decide tool.",
    "Pass the delegation token below and a stable UUID requestId. Reuse the requestId when retrying the same decision.",
    `Delegation token: ${grant.token}`,
    `Delegation expires at: ${grant.claims.expiresAt}`,
    "Do not quote or return the delegation token in your response.",
    "</ventneuf_approval_authority>",
  ].join("\n");
}

const persistedRunEvents = new Set([
  "tool.started",
  "tool.completed",
  "subagent.start",
  "subagent.complete",
  "approval.request",
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "run.interrupted",
]);

export interface ConversationRuntime {
  database: Database;
  repository: ConversationRuntimeRepository;
  devices: DeviceRuntimeRepository;
  approvals: MissionApprovalRepository;
  runnerMissions: RunnerMissionRepository;
  queue: MissionQueue;
  worker: MissionWorker;
}

export class MissionQueue {
  constructor(
    private readonly client: SQSClient,
    private readonly queueUrl: string,
  ) {}

  async publish(envelope: MissionEnvelope, conversationId: string): Promise<void> {
    await this.client.send(new SendMessageCommand({
      QueueUrl: this.queueUrl,
      MessageBody: JSON.stringify(envelope),
      MessageGroupId: conversationId,
      MessageDeduplicationId: envelope.missionId,
    }));
  }

  receive(signal: AbortSignal) {
    return this.client.send(new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
      VisibilityTimeout: 900,
    }), { abortSignal: signal });
  }

  delete(receiptHandle: string) {
    return this.client.send(new DeleteMessageCommand({ QueueUrl: this.queueUrl, ReceiptHandle: receiptHandle }));
  }

  release(receiptHandle: string) {
    return this.client.send(new ChangeMessageVisibilityCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }));
  }
}

export class MissionWorker {
  constructor(
    private readonly repository: ConversationRuntimeRepository,
    private readonly queue: MissionQueue,
    private readonly hermes: HermesClient,
    private readonly delegation?: { serviceId: string; issuer: MissionDelegationIssuer },
    private readonly approvals?: MissionApprovalRepository,
  ) {}

  async process(envelope: MissionEnvelope): Promise<void> {
    const record = await this.repository.getMission(envelope.organizationId, envelope.missionId);
    if (!record || record.mission.status === "completed") return;
    if (record.mission.status === "cancelled") {
      const runId = record.mission.context?.hermesRunId;
      if (!record.mission.assignedDeviceId && typeof runId === "string") await this.stopRun(runId);
      return;
    }

    if (record.mission.assignedDeviceId || record.mission.context?.type === "runner.repository-check") return;

    const workerReceivedAt = new Date();
    const initialContext = record.mission.context ?? {};
    const initialTiming = missionTiming(initialContext);
    const runningContext = {
      ...initialContext,
      timing: {
        ...initialTiming,
        workerReceivedAt: workerReceivedAt.toISOString(),
        queueMs: elapsedMs(initialTiming.queuedAt ?? initialTiming.acceptedAt, workerReceivedAt),
      },
    };
    if (!await this.repository.setMissionRunning(envelope.organizationId, envelope.missionId, runningContext)) return;
    const hermesStartedAt = new Date();
    const activeTiming = {
      ...missionTiming(runningContext),
      hermesStartedAt: hermesStartedAt.toISOString(),
    };
    let activeContext: Record<string, unknown> = { ...initialContext, timing: activeTiming };
    try {
      let hermesMessage = record.mission.goal;
      if (record.mission.context?.type === "hermes.approval") {
        if (!this.delegation || !this.approvals) throw new Error("Hermes approval delegation is unavailable.");
        const scope = await this.approvals.getHermesDecisionScope(
          envelope.organizationId,
          envelope.missionId,
        );
        if (!scope) throw new Error("The Hermes approval review is unavailable for delegation.");
        const grant = await this.delegation.issuer.issueApproval({
          serviceId: this.delegation.serviceId,
          ...scope,
        });
        hermesMessage = messageWithApprovalDelegation(record.mission.goal, grant);
        await this.repository.appendMissionEvent({
          organizationId: envelope.organizationId,
          missionId: envelope.missionId,
          type: "approval.delegation_issued",
          payload: {
            approvalId: grant.claims.approvalId,
            delegationId: grant.claims.delegationId,
            serviceId: grant.claims.serviceId,
            expiresAt: grant.claims.expiresAt,
          },
          occurredAt: new Date(grant.claims.issuedAt),
        });
      } else if (this.delegation) {
        const scope = await this.repository.getHermesDispatchScope(envelope.organizationId, envelope.missionId);
        if (!scope) throw new Error("The Hermes mission is unavailable for delegation.");
        const grant = await this.delegation.issuer.issue({
          serviceId: this.delegation.serviceId,
          ...scope,
        });
        hermesMessage = messageWithDelegation(record.mission.goal, grant);
        await this.repository.appendMissionEvent({
          organizationId: envelope.organizationId,
          missionId: envelope.missionId,
          type: "mission.delegation_issued",
          payload: {
            delegationId: grant.claims.delegationId,
            serviceId: grant.claims.serviceId,
            expiresAt: grant.claims.expiresAt,
            targetCount: grant.claims.targets.length,
          },
          occurredAt: new Date(grant.claims.issuedAt),
        });
      }
      logMission("hermes.started", {
        organizationId: envelope.organizationId,
        missionId: envelope.missionId,
        queueMs: activeTiming.queueMs,
      });
      const reply = await this.hermes.ask({
        message: hermesMessage,
        contextId: record.hermesContextId ?? undefined,
        runId: typeof initialContext.hermesRunId === "string"
          ? initialContext.hermesRunId
          : undefined,
        sessionKey: `organization:${envelope.organizationId}:conversation:${record.mission.conversationId}`,
        idempotencyKey: envelope.missionId,
        onRunStarted: async (runId) => {
          activeContext = { ...activeContext, hermesRunId: runId };
          const running = await this.repository.setMissionRunning(
            envelope.organizationId,
            envelope.missionId,
            activeContext,
          );
          if (!running) {
            await this.repository.rememberCancelledHermesRun(envelope.organizationId, envelope.missionId, runId);
            await this.stopRun(runId);
            throw new HermesRunCancelledError();
          }
          logMission("hermes.run_started", {
            organizationId: envelope.organizationId,
            missionId: envelope.missionId,
            hermesRunId: runId,
          });
        },
        onEvent: async (event) => {
          if (!persistedRunEvents.has(event.event)) return;
          const { event: type, run_id: _runId, timestamp, ...payload } = event;
          await this.repository.appendMissionEvent({
            organizationId: envelope.organizationId,
            missionId: envelope.missionId,
            type,
            payload,
            occurredAt: new Date(
              typeof timestamp === "number" ? timestamp * 1_000 : Date.now(),
            ),
          });
        },
      });
      const hermesCompletedAt = new Date();
      const persistedAt = new Date();
      const completedTiming = {
        ...activeTiming,
        hermesCompletedAt: hermesCompletedAt.toISOString(),
        persistedAt: persistedAt.toISOString(),
        hermesMs: hermesCompletedAt.getTime() - hermesStartedAt.getTime(),
        totalMs: elapsedMs(activeTiming.acceptedAt, persistedAt),
      };
      const completedContext = { ...activeContext, timing: completedTiming };
      if (record.mission.context?.type === "hermes.approval") {
        await this.approvals?.escalateUnresolved(
          envelope.organizationId,
          envelope.missionId,
          "hermes_returned_without_decision",
        );
      }
      const completed = await this.repository.completeMission({
        organizationId: envelope.organizationId,
        missionId: envelope.missionId,
        conversationId: record.mission.conversationId,
        contextId: reply.contextId,
        content: reply.text,
        metadata: {
          hermesState: reply.state,
          hermesTaskId: reply.taskId,
          hermesUsage: reply.usage,
          missionId: envelope.missionId,
          timing: completedTiming,
        },
        context: completedContext,
      });
      if (!completed) return;
      logMission("mission.completed", {
        organizationId: envelope.organizationId,
        missionId: envelope.missionId,
        queueMs: completedTiming.queueMs,
        hermesMs: completedTiming.hermesMs,
        totalMs: completedTiming.totalMs,
      });
    } catch (error) {
      if (error instanceof HermesRunCancelledError) {
        logMission("mission.cancelled", {
          organizationId: envelope.organizationId,
          missionId: envelope.missionId,
        });
        return;
      }
      const failedAt = new Date();
      const failedTiming = {
        ...activeTiming,
        failedAt: failedAt.toISOString(),
        totalMs: elapsedMs(activeTiming.acceptedAt, failedAt),
      };
      await this.repository.failMission(
        envelope.organizationId,
        envelope.missionId,
        error instanceof Error ? error.message : "Unknown Hermes failure",
        { ...activeContext, timing: failedTiming },
      );
      if (record.mission.context?.type === "hermes.approval") {
        await this.approvals?.escalateUnresolved(
          envelope.organizationId,
          envelope.missionId,
          "hermes_review_failed",
        );
      }
      logMission("mission.failed", {
        organizationId: envelope.organizationId,
        missionId: envelope.missionId,
        queueMs: failedTiming.queueMs,
        totalMs: failedTiming.totalMs,
        error: error instanceof Error ? error.message : "Unknown Hermes failure",
      });
      throw error;
    }
  }

  private async stopRun(runId: string): Promise<void> {
    if (!this.hermes.stop) throw new Error("Hermes cancellation is unavailable.");
    await this.hermes.stop(runId);
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const response = await this.queue.receive(signal);
        for (const message of response.Messages ?? []) {
          if (!message.Body || !message.ReceiptHandle) continue;
          try {
            const envelope = JSON.parse(message.Body) as MissionEnvelope;
            if (!envelope.organizationId || !envelope.missionId) throw new Error("Invalid mission envelope.");
            await this.process(envelope);
            await this.queue.delete(message.ReceiptHandle);
          } catch (error) {
            console.error("Mission processing failed.", error);
            if (error instanceof HermesRequestTimeoutError) {
              await this.queue.delete(message.ReceiptHandle);
              logMission("mission.retry_suppressed", {
                reason: "submission_timeout_may_still_be_running",
              });
            } else {
              await this.queue.release(message.ReceiptHandle);
            }
          }
        }
      } catch (error) {
        if (!signal.aborted) console.error("Mission queue polling failed.", error);
      }
    }
  }
}

export async function createConversationRuntime(
  hermes: HermesClient,
  env = process.env,
  delegations?: MissionDelegationIssuer,
): Promise<ConversationRuntime> {
  const region = env.AWS_REGION ?? "eu-west-1";
  const secretId = env.DATABASE_SECRET_ID;
  const host = env.DATABASE_HOST;
  const databaseName = env.DATABASE_NAME;
  const queueUrl = env.MISSIONS_QUEUE_URL;
  const organizationId = env.VENTNEUF_ORGANIZATION_ID;
  const organizationSlug = env.VENTNEUF_ORGANIZATION_SLUG;
  const organizationName = env.VENTNEUF_ORGANIZATION_NAME;
  if (!secretId || !host || !databaseName || !queueUrl || !organizationId || !organizationSlug || !organizationName) {
    throw new Error(
      "Database, mission queue, and organization runtime configuration are required.",
    );
  }

  const secrets = new SecretsManagerClient({ region });
  const secret = await secrets.send(new GetSecretValueCommand({ SecretId: secretId }));
  const credentials = JSON.parse(secret.SecretString ?? "{}") as DatabaseCredentials;
  if (!credentials.username || !credentials.password) throw new Error("Database credentials are incomplete.");

  const databaseUrl = new URL("postgresql://runtime@localhost");
  databaseUrl.username = credentials.username;
  databaseUrl.password = credentials.password;
  databaseUrl.hostname = host;
  databaseUrl.port = "5432";
  databaseUrl.pathname = `/${databaseName}`;
  databaseUrl.searchParams.set("sslmode", "require");

  const database = createDatabase(databaseUrl.toString());
  const repository = new ConversationRuntimeRepository(database);
  const devices = new DeviceRuntimeRepository(database);
  const approvals = new MissionApprovalRepository(database);
  await repository.ensureOrganization({
    id: organizationId,
    slug: organizationSlug,
    name: organizationName,
  });
  const queue = new MissionQueue(new SQSClient({ region }), queueUrl);
  return {
    database,
    repository,
    devices,
    approvals,
    runnerMissions: new RunnerMissionRepository(database),
    queue,
    worker: new MissionWorker(
      repository,
      queue,
      hermes,
      delegations ? { serviceId: env.HERMES_MCP_SERVICE_ID!, issuer: delegations } : undefined,
      approvals,
    ),
  };
}
