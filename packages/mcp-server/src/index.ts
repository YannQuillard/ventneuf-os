#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadConfig, type VaultName } from "./config.js";
import { askHermes } from "./hermes.js";
import { readKnowledge, searchKnowledge } from "./knowledge.js";
import { getMission, reportMissionProgress } from "./missions.js";

const config = loadConfig();
const server = new McpServer({ name: "ventneuf-os", version: "0.1.0" });
const vaultSchema = z.string().min(1);
const jsonResult = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>,
});

server.registerTool(
  "knowledge.search",
  {
    title: "Search ventneuf knowledge",
    description: "Search Markdown notes in the authorized Obsidian vaults.",
    inputSchema: {
      query: z.string().min(1),
      vaults: z.array(vaultSchema).min(1),
      limit: z.number().int().min(1).max(50).default(20),
    },
  },
  async ({ query, vaults, limit }) =>
    jsonResult(await searchKnowledge(config, query, vaults as VaultName[], limit)),
);

server.registerTool(
  "knowledge.read",
  {
    title: "Read a knowledge note",
    description: "Read one Markdown note from an authorized Obsidian vault.",
    inputSchema: { vault: vaultSchema, path: z.string().min(1) },
  },
  async ({ vault, path }) => jsonResult(await readKnowledge(config, vault, path)),
);

server.registerTool(
  "mission.get",
  {
    title: "Get mission state",
    description: "Return the latest locally recorded state of a mission.",
    inputSchema: { id: z.string().min(1) },
  },
  async ({ id }) => jsonResult((await getMission(config, id)) ?? { id, status: "unknown" }),
);

server.registerTool(
  "mission.report_progress",
  {
    title: "Report mission progress",
    description: "Append a timestamped status update to a local mission.",
    inputSchema: {
      id: z.string().min(1),
      status: z.string().min(1),
      summary: z.string().min(1).max(10_000),
    },
  },
  async ({ id, status, summary }) =>
    jsonResult(await reportMissionProgress(config, id, status, summary)),
);

server.registerTool(
  "hermes.ask",
  {
    title: "Ask Hermes",
    description: "Ask the authorized Hermes profile through the authenticated A2A endpoint.",
    inputSchema: {
      message: z.string().min(1).max(100_000),
      contextId: z.string().min(1).optional(),
    },
  },
  async ({ message, contextId }) => jsonResult(await askHermes(config, message, contextId)),
);

await server.connect(new StdioServerTransport());
