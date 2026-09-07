import { expect, test, type Page } from "@playwright/test";

const COMPOSER_URL = "/prototype/c/hermes";
const LONG_PASTE = "Long paste payload: " + "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ".repeat(7);
const OTHER_LONG_PASTE = "Different long paste payload: " + "one two three four five six seven eight nine ten ".repeat(7);
const REPEAT_WINDOW_MS = 1_500;
const PASTE_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";

function normalizeText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function openComposer(page: Page) {
  await page.goto(COMPOSER_URL);
  const editor = page.locator('[contenteditable="true"]:visible').first();
  await expect(editor).toBeVisible();
  await editor.focus();
  return editor;
}

async function paste(page: Page, text: string, fromKeyboard = true) {
  const editor = page.locator('[contenteditable="true"]:visible').first();
  await editor.focus();
  if (fromKeyboard) {
    await page.evaluate(async (value) => navigator.clipboard.writeText(value), text);
    await page.keyboard.press(`${PASTE_MODIFIER}+v`);
    return;
  }
  await editor.evaluate((element, value) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData,
    }));
  }, text);
}

async function submit(page: Page, expected: string) {
  const editor = page.locator('[contenteditable="true"]:visible').first();
  await editor.focus();
  await page.keyboard.press("Enter");
  const log = page.locator('[role="log"]');
  const normalizedExpected = normalizeText(expected);
  await expect.poll(async () => normalizeText((await log.textContent()) ?? "")).toContain(normalizedExpected);
  const normalizedLog = normalizeText((await log.textContent()) ?? "");
  expect(normalizedLog.split(normalizedExpected).length - 1).toBe(1);
}

test.describe("composer long paste", () => {
  test("expands from the hover card and submits the exact value once", async ({ page }) => {
    const editor = await openComposer(page);
    await page.keyboard.type("prefix ");
    await paste(page, LONG_PASTE);
    await page.keyboard.type("suffix");

    const token = page.locator('[contenteditable="true"]:visible [data-astryx-token]');
    await expect(token).toHaveCount(1);
    await token.hover();
    const expand = page.getByRole("button", { name: "Expand" });
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(token).toHaveCount(0);

    await submit(page, `prefix ${LONG_PASTE}\u00a0suffix`);
    await expect(page.locator('[role="log"]')).not.toContainText(`${LONG_PASTE.length} chars`);
    await expect(editor).toBeEmpty();
  });

  test("keeps a hovered token intact while typing and submitting", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    const token = page.locator('[contenteditable="true"]:visible [data-astryx-token]');
    await token.hover();
    await expect(page.getByRole("button", { name: "Expand" })).toBeVisible();
    await page.keyboard.type("suffix");

    await expect(token).toHaveCount(1);
    await submit(page, `${LONG_PASTE}\u00a0suffix`);
    await expect(page.locator('[role="log"]')).not.toContainText(`${LONG_PASTE.length} chars`);
  });

  test("expands the prior keyboard paste when the same paste is repeated", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    // Repeat immediately so a slow CI assertion cannot expire the 1.5 second product window.
    await paste(page, LONG_PASTE);

    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(0);
    await expect(page.locator('[contenteditable="true"]:visible').first()).toHaveText(LONG_PASTE);
    await submit(page, LONG_PASTE);
  });

  test("does not consume a changed clipboard value", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    await paste(page, OTHER_LONG_PASTE);
    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(2);
  });

  test("does not consume a repeat after the caret moves", async ({ page }) => {
    const editor = await openComposer(page);
    await paste(page, LONG_PASTE);
    await editor.evaluate((element) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await paste(page, LONG_PASTE);
    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(2);
  });

  test("does not consume a repeat after typing", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    await page.keyboard.type("typed");
    await paste(page, LONG_PASTE);
    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(2);
  });

  test("does not consume a repeat after the repeat window", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    await page.waitForTimeout(REPEAT_WINDOW_MS + 100);
    await paste(page, LONG_PASTE);
    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(2);
  });

  test("does not consume a normal paste", async ({ page }) => {
    await openComposer(page);
    await paste(page, LONG_PASTE);
    await paste(page, LONG_PASTE, false);
    await expect(page.locator('[contenteditable="true"]:visible [data-astryx-token]')).toHaveCount(2);
  });
});
