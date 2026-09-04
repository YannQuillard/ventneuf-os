import {
  ChangeMessageVisibilityCommand,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { ConversationRuntimeRepository, createDatabase, type Database } from "@ventneuf/database";
import {
  HermesRequestTimeoutError,
  HermesRunCancelledError,
  type HermesClient,
} from "./hermes.js";

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
  ) {}

  async process(envelope: MissionEnvelope): Promise<void> {
    const record = await this.repository.getMission(envelope.organizationId, envelope.missionId);
    if (!record || record.mission.status === "completed" || record.mission.status === "cancelled") return;

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
    await this.repository.setMissionRunning(envelope.organizationId, envelope.missionId, runningContext);
    const hermesStartedAt = new Date();
    const activeTiming = {
      ...missionTiming(runningContext),
      hermesStartedAt: hermesStartedAt.toISOString(),
    };
    logMission("hermes.started", {
      organizationId: envelope.organizationId,
      missionId: envelope.missionId,
      queueMs: activeTiming.queueMs,
    });
    let activeContext: Record<string, unknown> = { ...initialContext, timing: activeTiming };
    try {
      const reply = await this.hermes.ask({
        message: record.mission.goal,
        contextId: record.hermesContextId ?? undefined,
        runId: typeof initialContext.hermesRunId === "string"
          ? initialContext.hermesRunId
          : undefined,
        sessionKey: `organization:${envelope.organizationId}:conversation:${record.mission.conversationId}`,
        idempotencyKey: envelope.missionId,
        onRunStarted: async (runId) => {
          activeContext = { ...activeContext, hermesRunId: runId };
          await this.repository.setMissionRunning(
            envelope.organizationId,
            envelope.missionId,
            activeContext,
          );
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
      await this.repository.completeMission({
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

export async function createConversationRuntime(hermes: HermesClient, env = process.env): Promise<ConversationRuntime> {
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
  await repository.ensureOrganization({
    id: organizationId,
    slug: organizationSlug,
    name: organizationName,
  });
  const queue = new MissionQueue(new SQSClient({ region }), queueUrl);
  return { database, repository, queue, worker: new MissionWorker(repository, queue, hermes) };
}
