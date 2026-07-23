import { expect, test, type Page } from "@playwright/test";

import {
  startConversation,
  waitForStatus,
} from "../test/support/cabinet-api";
import { claudeFailure } from "../test/support/fake-agent-cli";
import { bootCabinet, type CabinetInstance } from "../test/support/harness";

test.describe.configure({ mode: "serial" });

let cabinet: CabinetInstance;
let conversationId: string;
let failedConversationId: string;

async function primeReturningUser(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("cabinet.dataDirConfirmed", "1");
    window.localStorage.setItem("cabinet.wizard-done", "1");
    window.localStorage.setItem("cabinet.tour-done", "1");
  });
}

test.beforeAll(async () => {
  cabinet = await bootCabinet({
    fakeAgents: [{ name: "claude" }],
    files: {
      "acceptance-cabinet/.cabinet": [
        "schemaVersion: 1",
        "id: acceptance-cabinet",
        "name: Acceptance Cabinet",
        "kind: room",
        "entry: index.md",
        "",
      ].join("\n"),
      "acceptance-cabinet/index.md": "# Acceptance Cabinet\n",
      "acceptance-cabinet/.agents/editor/persona.md": [
        "---",
        "name: Operator",
        "slug: editor",
        'emoji: "⚡"',
        "type: specialist",
        "department: engineering",
        "role: Local test operator",
        "provider: claude-code",
        "active: true",
        "setupComplete: true",
        "workspace: /",
        "---",
        "",
        "Local test fixture.",
        "",
      ].join("\n"),
    },
  });
  const conversation = await startConversation(cabinet, {
    cabinetPath: "acceptance-cabinet",
    userMessage: "Local rendering fixture.",
    draftOnly: true,
  });
  conversationId = conversation.id;

  await cabinet.agent("claude").program([
    claudeFailure("provider unavailable in local rendering fixture"),
  ]);
  const failedConversation = await startConversation(cabinet, {
    cabinetPath: "acceptance-cabinet",
    userMessage: "Failed turn rendering fixture.",
  });
  await waitForStatus(cabinet, failedConversation.id, "failed");
  failedConversationId = failedConversation.id;
});

test.afterAll(async () => {
  await cabinet?.close();
});

test("room shell exposes one stable accessible title before overview data settles", async ({
  page,
}) => {
  await primeReturningUser(page);
  await page.route("**/api/cabinets/overview?**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    await route.continue();
  });

  await page.goto(`${cabinet.appUrl}/room/acceptance-cabinet`);

  const title = page.getByRole("heading", {
    level: 1,
    name: "Acceptance Cabinet",
  });
  await expect(title).toBeVisible({ timeout: 4_000 });
  await expect(title).toHaveCount(1);
  await expect(page.getByRole("status", { name: "Loading Acceptance Cabinet" })).toBeVisible();

  await page.reload();
  await expect(title).toBeVisible({ timeout: 4_000 });
  await expect(title).toHaveCount(1);
});

test("conversation shell is immediate and survives reload and browser history", async ({
  page,
}) => {
  await primeReturningUser(page);
  const detailPath = `/api/agents/conversations/${conversationId}`;
  await page.route("**/api/agents/conversations/**", async (route) => {
    if (new URL(route.request().url()).pathname === detailPath) {
      await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
    await route.continue();
  });

  await page.goto(`${cabinet.appUrl}/room/acceptance-cabinet`);
  await page.goto(
    `${cabinet.appUrl}/room/acceptance-cabinet/-/tasks/${conversationId}`
  );
  const conversationHeading = page.getByRole("heading", { level: 1 });
  await expect(conversationHeading).toHaveCount(1);
  await expect(conversationHeading).toContainText(
    /Conversation|Local rendering fixture/
  );

  await page.reload();
  await expect(conversationHeading).toHaveCount(1);
  await expect(conversationHeading).toContainText(
    /Conversation|Local rendering fixture/
  );

  await page.goBack();
  await expect(
    page.getByRole("heading", { level: 1, name: "Acceptance Cabinet" })
  ).toBeVisible();
  await page.goForward();
  await expect(
    page.getByRole("heading", { level: 1, name: /Local rendering fixture/i })
  ).toBeVisible();
});

test("room and conversation remain viewport-bounded at 390x844", async ({ page }) => {
  await primeReturningUser(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  for (const path of [
    "/room/acceptance-cabinet",
    `/room/acceptance-cabinet/-/tasks/${conversationId}`,
  ]) {
    await page.goto(`${cabinet.appUrl}${path}`);
    await expect(page.locator("main, [data-testid='conversation-layout']").first()).toBeVisible();
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(width).toBeLessThanOrEqual(390);
    await expect(page.locator("body")).not.toContainText(
      /TypeError|ReferenceError|Unhandled Runtime Error/
    );
  }
});

test("a failed turn remains visible with a usable composer", async ({ page }) => {
  await primeReturningUser(page);
  await page.goto(
    `${cabinet.appUrl}/room/acceptance-cabinet/-/tasks/${failedConversationId}`
  );

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Failed turn rendering fixture.",
    })
  ).toBeVisible();
  await expect(
    page
      .getByTestId("conversation-transcript")
      .getByText("Failed turn rendering fixture.", { exact: true })
  ).toBeVisible();
  await expect(
    page.getByTestId("conversation-layout").getByText("Failed", { exact: true })
  ).toBeVisible();
  await expect(page.getByTestId("conversation-composer")).toBeVisible();
});
