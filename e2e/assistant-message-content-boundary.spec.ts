import { expect, test, type Page } from "@playwright/test";

import {
  ASSISTANT_MESSAGE_CONTENT_SELECTOR,
  ASSISTANT_TURN_SELECTOR,
  TURN_TEST_IDS,
} from "../src/lib/agents/assistant-message-contract";
import {
  bootIsolatedCabinet,
  type IsolatedCabinet,
} from "./production-acceptance/isolated-cabinet";

const CONVERSATION_ID = "ui-boundary";
const FIRST_RESPONSE = "SAFE_EXACT_RESPONSE";
const SECOND_RESPONSE = "SAFE_SECOND_RESPONSE";
const CONTENT_SELECTOR =
  `${ASSISTANT_TURN_SELECTOR} > ${ASSISTANT_MESSAGE_CONTENT_SELECTOR}`;

const detailFixture = {
  meta: {
    id: CONVERSATION_ID,
    agentSlug: "editor",
    title: "Safe UI boundary fixture",
    trigger: "manual",
    status: "completed",
    startedAt: "2026-07-23T00:00:00.000Z",
    completedAt: "2026-07-23T00:00:04.000Z",
    promptPath: ".agents/safe-prompt.md",
    transcriptPath: ".agents/safe-transcript.md",
    mentionedPaths: [],
    artifactPaths: [],
    adapterType: "hermes_runtime",
  },
  prompt: "Safe fixture prompt",
  request: "",
  transcript: "",
  rawTranscript: "",
  mentions: [],
  artifacts: [],
  turns: [
    {
      id: "safe-user-1",
      turn: 1,
      role: "user",
      ts: "2026-07-23T00:00:00.000Z",
      content: "Safe fixture request",
    },
    {
      id: "safe-assistant-1",
      turn: 2,
      role: "agent",
      ts: "2026-07-23T00:00:01.000Z",
      content: FIRST_RESPONSE,
      completedAt: "2026-07-23T00:00:02.000Z",
    },
    {
      id: "safe-user-2",
      turn: 3,
      role: "user",
      ts: "2026-07-23T00:00:03.000Z",
      content: "Safe follow-up request",
    },
    {
      id: "safe-assistant-2",
      turn: 4,
      role: "agent",
      ts: "2026-07-23T00:00:04.000Z",
      content: SECOND_RESPONSE,
      completedAt: "2026-07-23T00:00:04.000Z",
    },
  ],
  session: null,
};

test.describe.configure({ mode: "serial" });

let cabinet: IsolatedCabinet;

test.beforeAll(async () => {
  cabinet = await bootIsolatedCabinet(process.cwd());
});

test.afterAll(async () => {
  await cabinet?.close();
});

async function installSafeDetailFixture(page: Page, delayMs = 250): Promise<void> {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4342\/)/, (route) =>
    route.fulfill({ status: 204, body: "" }),
  );
  await page.route(
    `**/api/agents/conversations/events`,
    (route) => route.fulfill({ status: 204, body: "" }),
  );
  await page.route(
    `**/api/agents/conversations/${CONVERSATION_ID}/events`,
    (route) => route.fulfill({ status: 204, body: "" }),
  );
  await page.route(
    `**/api/agents/conversations/${CONVERSATION_ID}/events-log`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ events: [] }),
      }),
  );
  await page.route(
    `**/api/agents/conversations/${CONVERSATION_ID}/diffs`,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ diffs: [] }),
      }),
  );
  await page.route(
    `**/api/agents/conversations/${CONVERSATION_ID}?withTurns=1`,
    async (route) => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(detailFixture),
      });
    },
  );
}

async function assertCleanBrowser(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    body: document.body.scrollWidth > document.body.clientWidth,
  }));
  expect(overflow).toEqual({ document: false, body: false });
  await expect(
    page.locator(
      '[data-nextjs-dialog-overlay], [data-next-badge-root], nextjs-portal',
    ),
  ).toHaveCount(0);
}

for (const viewport of [
  { label: "desktop", width: 1440, height: 900 },
  { label: "mobile", width: 390, height: 844 },
] as const) {
  test(`${viewport.label}: waits through client loading and isolates persisted assistant text`, async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installSafeDetailFixture(page);

    await page.goto(`${cabinet.appUrl}/tasks/${CONVERSATION_ID}`);

    // This reproduces the old harness observation: count() does not wait for
    // TaskConversationPage's post-mount detail fetch.
    expect(await page.locator(CONTENT_SELECTOR).count()).toBe(0);

    const bodies = page.locator(CONTENT_SELECTOR);
    await expect(bodies).toHaveCount(2);
    expect(await bodies.allInnerTexts()).toEqual([
      FIRST_RESPONSE,
      SECOND_RESPONSE,
    ]);

    for (let index = 0; index < 2; index += 1) {
      const body = bodies.nth(index);
      const turn = body.locator("..");
      await expect(body).toHaveAttribute("role", "group");
      await expect(body).toHaveAttribute("aria-label", "Assistant message content");
      await expect(body).toHaveAttribute("data-message-lifecycle", "completed");
      await expect(body.getByTestId(TURN_TEST_IDS.roleLabel)).toHaveCount(0);
      await expect(body.getByTestId(TURN_TEST_IDS.timestamp)).toHaveCount(0);
      await expect(body.getByTestId(TURN_TEST_IDS.lifecycleStatus)).toHaveCount(0);
      expect(await turn.innerText()).not.toBe(await body.innerText());
    }

    await page.reload();
    await expect(page.locator(CONTENT_SELECTOR)).toHaveCount(2);
    expect(await page.locator(CONTENT_SELECTOR).allInnerTexts()).toEqual([
      FIRST_RESPONSE,
      SECOND_RESPONSE,
    ]);

    await assertCleanBrowser(page);
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
}

test("completed content survives an isolated Cabinet restart", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installSafeDetailFixture(page, 0);
  await page.goto(`${cabinet.appUrl}/tasks/${CONVERSATION_ID}`);
  await expect(page.locator(CONTENT_SELECTOR)).toHaveCount(2);

  await cabinet.restart();
  await page.goto(`${cabinet.appUrl}/tasks/${CONVERSATION_ID}`);
  await expect(page.locator(CONTENT_SELECTOR)).toHaveCount(2);
  expect(await page.locator(CONTENT_SELECTOR).allInnerTexts()).toEqual([
    FIRST_RESPONSE,
    SECOND_RESPONSE,
  ]);
  await assertCleanBrowser(page);
});
