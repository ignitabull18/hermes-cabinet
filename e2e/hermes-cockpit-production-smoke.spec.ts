import { createServer, type Server } from "node:http";

import { expect, test } from "@playwright/test";

import { bootCabinet, type CabinetInstance } from "../test/support/harness";

test.describe.configure({ mode: "serial" });

let agentApi: Server;
let cabinet: CabinetInstance;
const upstreamMethods: string[] = [];

test.beforeAll(async () => {
  agentApi = createServer((request, response) => {
    upstreamMethods.push(request.method ?? "UNKNOWN");
    const url = request.url ?? "/";
    response.setHeader("Content-Type", "application/json");
    if (url === "/health/detailed") {
      response.end(JSON.stringify({ status: "ok", version: "0.19.0", active_profile: "operator-os" }));
      return;
    }
    if (url.startsWith("/api/sessions?")) {
      response.end(JSON.stringify({ object: "list", data: [], has_more: false, limit: 100, offset: 0 }));
      return;
    }
    response.end(JSON.stringify({ object: "list", data: [] }));
  });
  await new Promise<void>((resolve) => agentApi.listen(0, "127.0.0.1", resolve));
  const address = agentApi.address();
  if (!address || typeof address === "string") throw new Error("Agent API smoke fixture did not bind a loopback port.");

  cabinet = await bootCabinet({
    startDaemon: false,
    env: {
      CABINET_RUNTIME_MODE: "hermes",
      CABINET_HERMES_API_URL: `http://127.0.0.1:${address.port}`,
      CABINET_HERMES_API_KEY: "production-smoke-secret",
      CABINET_HERMES_PROFILE: "operator-os",
      CABINET_HERMES_MANAGEMENT_URL: "",
      CABINET_HERMES_MANAGEMENT_TOKEN: "",
      CABINET_HERMES_GATEWAY_URL: "",
      CABINET_HERMES_GATEWAY_TOKEN: "",
      CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
    },
  });
});

test.afterAll(async () => {
  await cabinet?.close();
  await new Promise<void>((resolve, reject) => agentApi.close((error) => error ? reject(error) : resolve()));
});

async function completeOnboarding(page: import("@playwright/test").Page): Promise<void> {
  const useDefault = page.getByRole("button", { name: "Use default" });
  if (await useDefault.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await useDefault.click();
    await page.goto(`${cabinet.appUrl}/cockpit`);
  }
  const skipTour = page.getByRole("button", { name: "Skip tour" });
  if (await skipTour.waitFor({ state: "visible", timeout: 3_000 }).then(() => true).catch(() => false)) await skipTour.click();
}

test("real production route keeps Today usable without Hermes Management", async ({ page }) => {
  const consoleIssues: string[] = [];
  const unexpectedServerIssues: string[] = [];
  let expectedDaemonFailures = 0;
  page.on("console", (message) => {
    if (message.type() === "warning" || message.type() === "error") consoleIssues.push(`${message.type()}: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (response.status() < 500) return;
    if (new URL(response.url()).pathname === "/api/health/daemon") {
      expectedDaemonFailures += 1;
      return;
    }
    unexpectedServerIssues.push(`${response.status()} ${response.url()}`);
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${cabinet.appUrl}/cockpit`);
  await completeOnboarding(page);

  const root = page.getByTestId("daily-business-cockpit");
  await expect(root).toBeVisible();
  await expect(root.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(root.getByTestId("cockpit-management-unavailable")).toContainText(
    "Hermes Management is not configured. Management-backed intelligence is unavailable.",
  );
  await expect(root).not.toContainText("Missing server configuration");
  await expect(root).not.toContainText("CABINET_HERMES_MANAGEMENT_URL");
  await expect(root.getByText("The path is clear")).toBeVisible();

  await root.getByRole("button", { name: "More", exact: true }).click();
  await page.getByRole("menuitem", { name: "Systems" }).click();
  await expect(root.getByTestId("cockpit-systems-view")).toContainText(/hermes jobs/i);
  await expect(root.getByTestId("cockpit-systems-view")).toContainText("unavailable");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await root.getByRole("button", { name: "Today", exact: true }).click();
  await expect(root.getByRole("navigation", { name: "Cockpit mobile" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  const firstViewItems = root.locator(".cockpit-first-view > *");
  expect(await firstViewItems.first().evaluate((element) => getComputedStyle(element).animationName)).toBe("none");

  expect(expectedDaemonFailures).toBeGreaterThan(0);
  expect(consoleIssues.length).toBe(expectedDaemonFailures);
  expect(consoleIssues.every((issue) => issue.includes("502 (Bad Gateway)"))).toBe(true);
  expect(unexpectedServerIssues).toEqual([]);
  expect(upstreamMethods.length).toBeGreaterThan(0);
  expect(upstreamMethods.every((method) => method === "GET")).toBe(true);
  expect(await page.locator("body").innerText()).not.toMatch(/production-smoke-secret|\/Users\/|[A-Za-z]:\\Users\\/);
});
