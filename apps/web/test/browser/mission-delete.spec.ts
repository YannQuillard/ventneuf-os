import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const id = "00000000-0000-4000-8000-000000000002";
const memberId = "00000000-0000-4000-8000-000000000001";
const createdAt = new Date().toISOString();
async function openMission(page: Page, canManage = true, failFirst = false) {
  const payload = Buffer.from(JSON.stringify({ sub: "browser-test", email: "member@example.test", expiresAt: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  const signature = createHmac("sha256", "browser-tests-only-session-secret-00000000").update(payload).digest("base64url");
  await page.context().addCookies([{ name: "ventneuf_session", value: `${payload}.${signature}`, url: "http://127.0.0.1:3100" }]);
  let removed = false;
  let calls = 0;
  await page.route("**/api/workspace", route => route.fulfill({ json: {
    currentMember: { id: memberId, name: "Member" }, members: [], projects: [],
    conversations: removed ? [] : [{ id, title: "Performance mission", kind: "mission", ownerMemberId: memberId,
      recipients: [], canManage, canDelete: canManage, isOwner: canManage, createdAt, updatedAt: createdAt }],
  } }));
  await page.route("**/api/devices", route => route.fulfill({ json: { devices: [] } }));
  await page.route(`**/api/workspace/conversations/${id}/events`, route => route.fulfill({ contentType: "text/event-stream", body: "" }));
  await page.route(`**/api/workspace/conversations/${id}/messages`, route => route.fulfill({ json: { messages: [], mission: null, events: [], approvals: [] } }));
  await page.route(`**/api/workspace/conversations/${id}`, route => {
    expect(route.request().method()).toBe("DELETE");
    calls++;
    if (failFirst && calls === 1) return route.fulfill({ status: 503, json: { error: "unavailable" } });
    removed = true;
    return route.fulfill({ json: { id, deleted: true } });
  });
  await page.goto(`/c/${id}`);
  return () => calls;
}

test("mission deletion requires confirmation, removes navigation and survives reload", async ({ page }, testInfo) => {
  const calls = await openMission(page);
  await page.getByRole("button", { name: "Delete mission", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByText("Delete mission?", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("delete-mission.png"), fullPage: true, animations: "disabled" });
  expect(calls()).toBe(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(calls()).toBe(0);
  await page.getByRole("button", { name: "Delete mission", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete mission", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  await expect(page.getByRole("link", { name: "Performance mission", exact: true })).toHaveCount(0);
  expect(calls()).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Delete mission", exact: true })).toHaveCount(0);
});

test("failed deletion retains the mission and can be retried", async ({ page }) => {
  const calls = await openMission(page, true, true);
  await page.getByRole("button", { name: "Delete mission", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete mission", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/c/${id}$`));
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete mission", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  expect(calls()).toBe(2);
});

test("shared mission recipients cannot see the deletion action", async ({ page }) => {
  const calls = await openMission(page, false);
  await expect(page.getByText("Performance mission", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Delete mission", exact: true })).toHaveCount(0);
  expect(calls()).toBe(0);
});
