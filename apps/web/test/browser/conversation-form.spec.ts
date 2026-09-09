import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const memberId = "00000000-0000-4000-8000-000000000001";
const conversationId = "00000000-0000-4000-8000-000000000002";
const messageId = "00000000-0000-4000-8000-000000000003";
const sessionSecret = "browser-tests-only-session-secret-00000000";
const createdAt = new Date().toISOString();

async function openForm(page: Page, options: { otherMember?: boolean; failFirst?: boolean; projectChat?: boolean } = {}) {
  const payload = Buffer.from(JSON.stringify({ sub: "browser-test", email: "member@example.test", expiresAt: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  const signature = createHmac("sha256", sessionSecret).update(payload).digest("base64url");
  await page.context().addCookies([{ name: "ventneuf_session", value: `${payload}.${signature}`, url: "http://127.0.0.1:3100" }]);
  const form = { title: "Prepare the performance mission", requestedByMemberId: memberId, parentMissionId: conversationId, requestId: messageId,
    questions: [
      { id: "objective", label: "Objective", mode: "text", options: [], defaultValues: ["Improve product listing performance"] },
      { id: "lead", label: "Lead model", mode: "single", options: [{ value: "opus", label: "Opus · high" }, { value: "sonnet", label: "Sonnet · high" }], defaultValues: ["opus"] },
      { id: "subagents", label: "Sub-agent models", mode: "multiple", options: [{ value: "opus", label: "Opus" }, { value: "sonnet", label: "Sonnet" }], defaultValues: ["opus"] },
    ] };
  const messages: unknown[] = [{ id: messageId, role: "assistant", content: form.title, createdAt, metadata: { questionnaire: form } }];
  const submissions: Array<{ questionnaireReply: { messageId: string; answers: Record<string, string[]> } }> = [];
  await page.route("**/api/workspace", route => route.fulfill({ json: {
    currentMember: { id: options.otherMember ? "other-member" : memberId, name: "Member" }, members: [], projects: options.projectChat ? [{ id: "project", name: "Performance project", context: {},
      generalConversationId: conversationId, ownerMemberId: memberId, repositoryAssociations: [], recipients: [], canManage: true, isOwner: true, createdAt, updatedAt: createdAt }] : [],
    conversations: [{ id: conversationId, title: "Performance", kind: "private", ...(options.projectChat ? { projectId: "project", isProjectGeneral: true } : {}), ownerMemberId: memberId, recipients: [], canManage: true, isOwner: true, createdAt, updatedAt: createdAt }],
  } }));
  await page.route("**/api/devices", route => route.fulfill({ json: { devices: [] } }));
  await page.route(`**/api/workspace/conversations/${conversationId}/events`, route => route.fulfill({ contentType: "text/event-stream", body: "" }));
  await page.route(`**/api/workspace/conversations/${conversationId}/messages`, async route => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      submissions.push(body);
      if (options.failFirst && submissions.length === 1) return route.fulfill({ status: 503, json: { error: "unavailable" } });
      Object.assign(form, { answers: body.questionnaireReply.answers, answerMissionId: "answer-mission" });
      const message = { id: "answer-message", role: "user", content: "Confirmed mission choices", createdAt, memberId };
      messages.push(message);
      return route.fulfill({ status: 202, json: { message, missionId: "answer-mission", status: "queued", timing: {} } });
    }
    return route.fulfill({ json: { messages, mission: null, events: [], approvals: [] } });
  });
  await page.goto(options.projectChat ? "/projects/project" : `/c/${conversationId}`);
  await expect(page.getByRole("button", { name: "Continue with these answers" })).toBeVisible({ visible: !options.otherMember });
  return submissions;
}

test("prefilled chat form accepts edited choices and retains the submitted summary", async ({ page }, testInfo) => {
  const submissions = await openForm(page);
  await page.screenshot({ path: testInfo.outputPath("prefilled-form.png"), fullPage: true });
  await expect(page.getByRole("textbox", { name: "Objective" })).toHaveValue("Improve product listing performance");
  await page.getByRole("textbox", { name: "Objective" }).fill("Optimize pagination and images");
  await page.getByRole("combobox", { name: "Lead model" }).click();
  await page.getByRole("option", { name: "Sonnet · high" }).click();
  await page.getByRole("button", { name: "Continue with these answers" }).click();
  await expect(page.getByText("Answers sent", { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(1);
  expect(submissions[0].questionnaireReply).toEqual({ messageId, answers: { objective: ["Optimize pagination and images"], lead: ["sonnet"], subagents: ["opus"] } });
  await page.reload();
  await expect(page.getByText("Answers sent", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with these answers" })).toHaveCount(0);
});

test("chat form keeps edits after a failure and supports free-text alternatives", async ({ page }) => {
  const submissions = await openForm(page, { failFirst: true });
  await page.getByRole("textbox", { name: "Objective" }).fill("");
  await page.getByRole("button", { name: "Continue with these answers" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Answer each question" })).toHaveText("Answer each question before continuing.");
  expect(submissions).toHaveLength(0);
  await page.getByRole("textbox", { name: "Objective" }).fill("Investigate slow categories");
  await page.getByRole("button", { name: "Write a different answer" }).first().click();
  await page.getByRole("textbox", { name: "Lead model" }).fill("Use the model confirmed earlier");
  await page.getByRole("button", { name: "Continue with these answers" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to submit" })).toContainText("Unable to submit this form");
  await expect(page.getByRole("textbox", { name: "Lead model" })).toHaveValue("Use the model confirmed earlier");
  await page.getByRole("button", { name: "Continue with these answers" }).click();
  await expect(page.getByText("Answers sent", { exact: true })).toBeVisible();
  expect(submissions).toHaveLength(2);
});

test("another conversation member sees who must answer without submission controls", async ({ page }) => {
  await openForm(page, { otherMember: true });
  await expect(page.getByText("Waiting for answers from the member who requested this form.")).toBeVisible();
});


test("the reply arrow quotes Hermes, addresses the reply, and preserves the draft", async ({ page }) => {
  await openForm(page, { projectChat: true });
  const editor = page.locator('[contenteditable="true"]:visible').first();
  await editor.fill("Keep the previously confirmed models.");
  await page.getByRole("button", { name: "Reply to this Hermes message", exact: true }).click();
  await expect(editor).toContainText("@hermes");
  await expect(editor).toContainText("Prepare the performance mission");
  await expect(editor).toContainText("Keep the previously confirmed models.");
  await expect(page.getByRole("button", { name: "Reply to Hermes", exact: true })).toHaveCount(0);
  await expect(editor).toBeFocused();
});
