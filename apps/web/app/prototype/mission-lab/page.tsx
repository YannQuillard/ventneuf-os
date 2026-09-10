"use client";

import { useEffect, useRef, useState } from "react";
import { ChatComposer } from "@astryxdesign/core/Chat";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import { HStack, VStack } from "@astryxdesign/core/Layout";
import { Heading, Text } from "@astryxdesign/core/Text";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import styles from "./page.module.css";

type Mode = "running" | "hermes" | "human" | "completed" | "unknown";
const modes: { id: Mode; label: string; title: string; detail: string }[] = [
  { id: "running", label: "Working", title: "Latest activity · measuring the listing pages", detail: "Reported by Claude Code. No decision is currently requested from you." },
  { id: "hermes", label: "Hermes reviewing", title: "Waiting for Hermes", detail: "Hermes is reviewing permission to run the baseline build. No action needed from you." },
  { id: "human", label: "Your decision", title: "One decision needs you", detail: "Claude wants to merge the pull request. This is outside Hermes’s delegated authority." },
  { id: "completed", label: "Finished", title: "Agent reported completion", detail: "Its final response includes validation limitations. Completion does not mean that every check passed." },
  { id: "unknown", label: "No recent activity", title: "No recent activity received", detail: "The last saved events remain available. There is not enough information to say what the agent is doing now." },
];
const history = [
  { time: "00:00", title: "Located the product listing routes", status: "Done", detail: "Identified the shared catalogue, product cards and collection pages. Started an independent review of the planned changes." },
  { time: "00:43", title: "Read project memory", status: "Denied", detail: "Two project memory reads were blocked by the worktree-only file rule. The agent continued without that context. This was a supervisor denial, not a decision requested from the member." },
  { time: "06:32", title: "Build baseline · approved by Hermes", status: "Failed", detail: "Permission was granted and the command ran, but the build exited with code 1. The next attempt to read its log was blocked by the approval-resumption guard." },
  { time: "07:02", title: "Resume local edits after approval", status: "Denied", detail: "The supervisor still required the previously approved command. It rejected local edits and a log read. A fresh continuation eventually resumed the work." },
];
const delivery = [
  { time: "16:59", title: "Push the mission branch", status: "Done", detail: "Hermes approved the push. The broker then reported that the branch was pushed successfully. Approval and execution are separate events." },
  { time: "17:47", title: "Create pull request · 3 unsuccessful attempts", status: "Failed", detail: "Each request was approved, but the broker returned exit code 1 without the underlying diagnostic. Configuring upstream tracking did not resolve it." },
  { time: "22:16", title: "Create pull request from the worktree", status: "Done", detail: "The command succeeded when executed directly from the mission worktree after approval. A pull request was opened; nothing was merged." },
];

function EventRow({ time, title, status, detail, onAsk }: { time: string; title: string; status: string; detail: string; onAsk?: (title: string) => void }) {
  return <details className={styles.event}>
    <summary><Text type="supporting" hasTabularNumbers>{time}</Text><Text>{title}</Text>
      <Text type="supporting" className={status === "Denied" || status === "Failed" ? styles.problem : styles.success}>{status}</Text></summary>
    <div className={styles.eventDetail}><Text>{detail}</Text>{onAsk ? <Button label="Ask Hermes about this" size="sm" variant="ghost" onClick={() => onAsk(title)} /> : null}</div>
  </details>;
}

export default function MissionLab() {
  const [mode, setMode] = useState<Mode>("running");
  const [tab, setTab] = useState("session");
  const [filter, setFilter] = useState("all");
  const [decision, setDecision] = useState<string>();
  const [earlier, setEarlier] = useState(false);
  const [draft, setDraft] = useState("");
  const [localMessages, setLocalMessages] = useState<string[]>([]);
  const [mobileView, setMobileView] = useState("activity");
  const conversationEnd = useRef<HTMLDivElement>(null);
  const approvalRef = useRef<HTMLElement>(null);
  useEffect(() => { conversationEnd.current?.scrollIntoView({ block: "nearest" }); }, [localMessages.length]);
  const askAbout = (title: string) => {
    setDraft(previous => `${previous ? `${previous}\n\n` : ""}About “${title}”: `);
    setMobileView("hermes");
  };
  const submitPreview = (value: string) => {
    if (!value.trim()) return;
    setLocalMessages(previous => [...previous, value.trim()]);
    setDraft(""); setMobileView("hermes");
  };
  const current = modes.find(entry => entry.id === mode)!;
  const show = (status: string) => filter !== "issues" || status === "Denied" || status === "Failed";
  return <div className={styles.page}>
    <div className={styles.preview}>
      <Text type="supporting">DESIGN PREVIEW · Anonymized incident reconstruction, not a live mission</Text>
      <HStack gap={1} wrap="wrap">{modes.map(entry => <Button key={entry.id} label={entry.label} size="sm"
        variant={entry.id === mode ? "secondary" : "ghost"} onClick={() => { setMode(entry.id); setDecision(undefined); }} />)}</HStack>
    </div>
    <header className={styles.header}>
      <Text type="supporting">Storefront / Missions</Text>
      <Heading level={1}>Make product listings faster</Heading>
      <Text type="supporting">Claude Code · Opus · Isolated worktree · Private mission</Text>
    </header>
    <section className={styles.current} aria-label="Current mission activity" aria-live="polite" data-attention={mode === "human" && !decision}>
      <div className={styles.indicator} />
      <VStack gap={1}><Text type="label">{decision ? `Decision recorded · ${decision}` : current.title}</Text>
        <Text type="supporting">{decision ? "Preview only. No repository action was performed." : current.detail}</Text></VStack>
      {mode === "human" && !decision ? <Button label="Review request" size="sm" onClick={() => {
        setMobileView("hermes"); requestAnimationFrame(() => approvalRef.current?.scrollIntoView({ block: "start" }));
      }} /> : <Text type="supporting" className={styles.elapsed}>Replay · 24 min</Text>}
    </section>
    <div className={styles.mobileSwitcher}>
      <Button label="Activity" size="sm" variant={mobileView === "activity" ? "secondary" : "ghost"} onClick={() => setMobileView("activity")} />
      <Button label="Hermes conversation" size="sm" variant={mobileView === "hermes" ? "secondary" : "ghost"} onClick={() => setMobileView("hermes")} />
    </div>
    <div className={styles.layout} data-mobile-view={mobileView}>
      <section className={styles.session} aria-label="Mission workspace">
        <TabList value={tab} onChange={setTab} hasDivider role="tablist" aria-label="Mission views">
          <Tab value="session" label="Session" panelId="mission-lab-content" />
          <Tab value="changes" label="Changes" panelId="mission-lab-content" />
          <Tab value="evidence" label="Evidence" panelId="mission-lab-content" />
        </TabList>
        <div id="mission-lab-content" role="tabpanel" className={styles.content}>
          {tab === "session" ? <>
            <div className={styles.toolbar}><Text type="supporting">SESSION REPLAY</Text><HStack gap={1}>
              <Button label="All activity" size="sm" variant={filter === "all" ? "secondary" : "ghost"} onClick={() => setFilter("all")} />
              <Button label="Issues only" size="sm" variant={filter === "issues" ? "secondary" : "ghost"} onClick={() => { setFilter("issues"); setEarlier(true); }} />
            </HStack></div>
            <Button label={earlier ? "Hide earlier activity" : "Show earlier activity · audit and implementation"} size="sm" variant="ghost" onClick={() => setEarlier(!earlier)} />
            {earlier ? <div className={styles.earlier}>{history.filter(entry => show(entry.status)).map(entry => <EventRow key={entry.time} {...entry} onAsk={askAbout} />)}</div> : null}
            {filter === "all" ? <div className={styles.message}>
              <Text type="supporting">Claude Code · Lead agent</Text>
              <Text as="p">The changes are committed. I’m opening the pull request, then checking the preview and comparing the listing pages with production.</Text>
            </div> : null}
            {delivery.filter(entry => show(entry.status)).map(entry => <EventRow key={entry.time} {...entry} onAsk={askAbout} />)}
            {filter === "all" ? <>
              <details className={styles.agent}><summary><Text type="label">Review agent</Text><Text type="supporting">Completed · no defects reported</Text></summary>
                <VStack gap={2} padding={4}><Text>Reviewed catalogue caching, revalidation and the data passed to “Add to quote”.</Text>
                  <Text type="supporting">The review supports the implementation. It does not replace a successful build or performance measurements.</Text></VStack>
              </details>
              <div className={styles.message}><Text type="supporting">Claude Code · Lead agent</Text>
                <Text as="p">The pull request is open and the deploy preview built successfully. Before/after response-time and LCP measurements still need verification.</Text></div>
              <EventRow time="23:00" title="Check preview build" status="Done" detail="The deployment provider reported a successful preview build. The separate GitHub build job was still pending at this point." />
              {mode === "hermes" ? <EventRow time="Now" title="Baseline build · Hermes is reviewing" status="Waiting" detail="Claude requested execution outside its native sandbox to complete the baseline build. Hermes is checking its delegated authority. You do not need to approve this request." />
                : mode === "running" ? <details className={styles.active} open><summary><Text type="label">Measure preview and production</Text><Text type="supporting">Running</Text></summary>
                  <CodeBlock code="scripts/measure-listing.sh <preview-url>\nscripts/measure-listing.sh <production-url>" title="Current command" language="shell" size="sm" width="100%" isWrapped />
                  <Text type="supporting">Waiting for comparable measurements. No performance gain has been confirmed yet.</Text></details> : null}
            </> : <Text type="supporting">Showing the reconstructed refusals and failures, including attempts the mission recovered from.</Text>}
          </> : tab === "changes" ? <VStack gap={4}>
            <Heading level={3} accessibilityLevel={2}>Four committed changes</Heading>
            {[["Catalogue cache", "Share the catalogue read across filters and search."], ["Product cards", "Reduce client data and request images sized for the grid."], ["Page title", "Render the title before JavaScript hydration."], ["Performance report", "Document the audit and a repeatable measurement script."]].map(([label, detail]) => <EventRow key={label} time="Commit" title={label} status="Ready" detail={detail} />)}
            <Text type="supporting">This preview describes the observed changes. Source diffs are not included in the fixture.</Text>
          </VStack> : <VStack gap={3}>
            <Heading level={3} accessibilityLevel={2}>Reported checks</Heading>
            <EventRow time="Check" title="ESLint" status="Done" detail="Reported passing by the agent." />
            <EventRow time="Check" title="Deploy preview build" status="Done" detail="Reported successful by the deployment provider." />
            <EventRow time="Check" title="TypeScript" status="Failed" detail="The agent reported a pre-existing generated image type issue. It was not a clean typecheck." />
            <EventRow time="Check" title="GitHub build" status="Pending" detail="Still pending at this point in the reconstruction." />
            <EventRow time="Measure" title="Before/after response time and LCP" status="Missing" detail="Comparable measurements were not yet verified. Preview availability alone does not demonstrate a performance improvement." />
          </VStack>}
        </div>
      </section>
      <aside className={styles.aside} aria-label="Conversation with Hermes">
        <div className={styles.chatHeader}>
          <Heading level={3} accessibilityLevel={2}>Hermes</Heading>
          <Text type="supporting">Conversation about this mission</Text>
        </div>
        <div className={styles.chatMessages} aria-label="Mission conversation">
          {mode === "human" && !decision ? <section ref={approvalRef} className={styles.approval} aria-label="Your approval is required">
      <VStack gap={3}>
        <Heading level={3} accessibilityLevel={2}>Merge the performance changes?</Heading>
        <Text>This updates the project’s main branch and may trigger its production deployment. The pull request exists, but before/after validation is incomplete.</Text>
        <details><summary>Review the proposed action</summary><CodeBlock code="gh pr merge --squash" language="shell" size="sm" isWrapped width="100%" />
          <Text type="supporting">Illustrative request · target: project main branch · one merge only</Text></details>
        <HStack gap={2} wrap="wrap"><Button label="Approve merge" variant="primary" onClick={() => setDecision("approved")} />
          <Button label="Reject merge" onClick={() => setDecision("rejected")} /></HStack>
      </VStack>
    </section> : null}
          <div className={styles.chatMessage}>
            <Text type="label">You</Text>
            <Text as="p">Improve the loading time of the product listing pages.</Text>
            <Text type="supporting">Example mission request</Text>
          </div>
          <div className={styles.chatMessage}>
            <Text type="label">Hermes</Text>
            <Text as="p">You can ask me about the mission here while following the agent’s work alongside it.</Text>
            <Text type="supporting">Illustrative message</Text>
          </div>
          {localMessages.map((message, index) => <div key={index} className={styles.chatMessage}>
            <Text type="label">You</Text><Text as="p" className={styles.userText}>{message}</Text>
            <Text type="supporting">Local preview · not sent to Hermes</Text>
          </div>)}
          {localMessages.length ? <Text type="supporting" role="status">Message added to this preview. Live replies and mission instructions are not connected here.</Text> : null}
          <div ref={conversationEnd} />
        </div>
        <div className={styles.composer}>
          <ChatComposer value={draft} onChange={setDraft} onSubmit={submitPreview} placeholder="Message Hermes about this mission…"
            density="compact" elevation="none" footerActions={<Text type="supporting">Local preview only</Text>} />
        </div>
      </aside>
    </div>
  </div>;
}
