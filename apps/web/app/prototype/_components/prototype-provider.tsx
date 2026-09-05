"use client";

import { createContext, useCallback, useContext, useMemo, useReducer, useRef, type ReactNode } from "react";
import { PROTOTYPE_NOW, prototypeData } from "../../../lib/prototype/fixtures";
import { isTerminal, missionsForConversation, prototypeReducer, type PrototypeAction } from "../../../lib/prototype/state";
import type { Mission, PrototypeData } from "../../../lib/prototype/types";

interface PrototypeContextValue {
  data: PrototypeData;
  dispatch: (action: PrototypeAction) => void;
  clock: () => string;
  decideApproval: (approvalId: string, outcome: "approved" | "rejected") => void;
  cancelMission: (missionId: string) => void;
  retryMission: (missionId: string) => void;
  sendMessage: (conversationId: string, content: string) => void;
}

const PrototypeContext = createContext<PrototypeContextValue | null>(null);

const REPLY_DELAY_MS = 1_400;

function agentName(mission: Mission): string {
  return mission.agent === "codex" ? "Codex" : "Claude";
}

function cannedReply(data: PrototypeData, conversationId: string, content: string): string {
  const conversation = data.conversations.find((entry) => entry.id === conversationId);
  const active = missionsForConversation(data, conversationId).find((mission) => !isTerminal(mission.status));
  if (active) {
    return `Passed to ${agentName(active)} as a redirection for the current mission. It will adjust after the step in progress and report back here.`;
  }
  if (conversation?.kind === "temporary") {
    return "Noted. This is a temporary conversation, so nothing here is written to durable knowledge.";
  }
  if (conversation?.knowledgeScope === "project") {
    return `Noted for ${conversation.title}. I can turn this into a mission or save it to project knowledge when you are ready.`;
  }
  return `Noted. Want me to save “${content.slice(0, 48)}${content.length > 48 ? "…" : ""}” to your personal knowledge?`;
}

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [data, dispatch] = useReducer(prototypeReducer, prototypeData);
  const mountedAt = useRef<number | undefined>(undefined);
  const latest = useRef(data);
  latest.current = data;

  const clock = useCallback(() => {
    mountedAt.current ??= Date.now();
    return new Date(new Date(PROTOTYPE_NOW).getTime() + (Date.now() - mountedAt.current)).toISOString();
  }, []);

  const value = useMemo<PrototypeContextValue>(() => ({
    data,
    dispatch,
    clock,
    decideApproval: (approvalId, outcome) => dispatch({ type: "decideApproval", approvalId, outcome, at: clock() }),
    cancelMission: (missionId) => dispatch({ type: "cancelMission", missionId, at: clock() }),
    retryMission: (missionId) => dispatch({ type: "retryMission", missionId, at: clock() }),
    sendMessage: (conversationId, content) => {
      dispatch({ type: "sendMessage", conversationId, content, at: clock() });
      window.setTimeout(() => {
        dispatch({
          type: "receiveReply",
          conversationId,
          content: cannedReply(latest.current, conversationId, content),
          at: clock(),
        });
      }, REPLY_DELAY_MS);
    },
  }), [clock, data]);

  return <PrototypeContext value={value}>{children}</PrototypeContext>;
}

export function usePrototype(): PrototypeContextValue {
  const value = useContext(PrototypeContext);
  if (!value) throw new Error("usePrototype must be used inside PrototypeProvider.");
  return value;
}
