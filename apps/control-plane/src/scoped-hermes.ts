import { z } from "zod";
import { RunsHermesClient, type AskHermesInput, type HermesClient, type TokenProvider } from "./hermes.js";

const scopeIdSchema = z.string().regex(/^[a-f0-9]{64}$/);
const noteSchema = z.object({
  id: z.string().min(1).max(2048), title: z.string().max(300), path: z.string().min(1).max(1024).refine(value => !value.startsWith("/") && !value.includes("\\")
    && !value.split("/").some(part => part === ".." || part === ".") && !/^[a-z]:/i.test(value)),
  updatedAt: z.string(), summary: z.string().max(1000).optional(),
});
export type MemoryEntry = z.infer<typeof noteSchema>;

/** Routes an authorized scope to its native, separately mounted Hermes profile. */
export class ScopedHermesClient implements HermesClient {
  private readonly baseUrl: string;
  constructor(url: string, private readonly tokens: TokenProvider, private readonly request: typeof fetch = fetch) {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new Error("The Hermes scope gateway URL is invalid.");
    }
    this.baseUrl = url.replace(/\/$/, "");
  }

  private scopeUrl(scopeId: string) {
    return `${this.baseUrl}/scopes/${scopeIdSchema.parse(scopeId)}`;
  }

  private async gateway(path: string, method: "GET" | "POST" = "GET", timeoutMs = 10_000) {
    const response = await this.request(path, {
      method, headers: { authorization: `Bearer ${await this.tokens.getToken()}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Upstream errors may contain private paths or configuration; expose a stable message.
    if (!response.ok) throw new Error("The scoped Hermes workspace is temporarily unavailable.");
    return response;
  }

  async ask(input: AskHermesInput) {
    if (!input.scopeId) throw new Error("An authorized Hermes memory scope is required.");
    const url = this.scopeUrl(input.scopeId);
    await this.gateway(url, "POST", 60_000);
    const before = await this.listMemory(input.scopeId).catch(() => undefined);
    const reply = await new RunsHermesClient(url, this.tokens, this.request).ask(input);
    const after = before ? await this.listMemory(input.scopeId).catch(() => undefined) : undefined;
    if (!before || !after) return reply;
    const versions = new Map(before.entries.map(entry => [entry.id, entry.updatedAt]));
    const memoryChanges = after.entries.filter(entry => versions.get(entry.id) !== entry.updatedAt);
    return memoryChanges.length ? { ...reply, memoryChanges } : reply;
  }

  async stop(runId: string, scopeId?: string) {
    if (!scopeId) throw new Error("An authorized Hermes memory scope is required.");
    await new RunsHermesClient(this.scopeUrl(scopeId), this.tokens, this.request).stop(runId);
  }

  async listMemory(scopeId: string): Promise<{ entries: MemoryEntry[] }> {
    const response = await this.gateway(`${this.scopeUrl(scopeId)}/notes`);
    return z.object({ entries: z.array(noteSchema).max(500) }).parse(await response.json());
  }

  async readMemory(scopeId: string, entryId: string): Promise<{ entry: MemoryEntry & { content: string } }> {
    const response = await this.gateway(`${this.scopeUrl(scopeId)}/notes/${encodeURIComponent(entryId)}`);
    return z.object({ entry: noteSchema.extend({ content: z.string().max(200_000) }) }).parse(await response.json());
  }
}
