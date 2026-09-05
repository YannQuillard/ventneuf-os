import { AgentDevelopmentAdapter } from "./codex-development.js";

export class ClaudeDevelopmentAdapter extends AgentDevelopmentAdapter {
  constructor(options: {
    orcaPath: string;
    claudePath: string;
    gitPath?: string;
    stateDirectory?: string;
    diagnosticRetentionMs?: number;
  }) {
    super({ ...options, agent: "claude", agentPath: options.claudePath });
  }
}
