import { expect, test, type Page } from "@playwright/test";
import {
  buildHermesRuntimeInterventionFixtureProjection,
} from "../src/lib/hermes/control-center-intervention-fixture";
import { bootCabinet, type CabinetInstance } from "../test/support/harness";

test.describe.configure({ mode: "serial" });

let cabinet: CabinetInstance;
const fixture = buildHermesRuntimeInterventionFixtureProjection({
  implementationRevision: "phase-4a-browser-contract",
  artifactGeneratedAt: "2026-07-20T04:26:28.000Z",
});
const controlledProjection = structuredClone(fixture);
controlledProjection.provenance = {
  kind: "live_runtime",
  label: "Live runtime projection",
  capturedAt: "2026-07-20T04:26:28.000Z",
  fixtureId: null,
};
const browserErrors = new WeakMap<Page, string[]>();

async function prepare(page: Page) {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));

  let mutationCalls = 0;
  await page.route("**/api/hermes/runtime-interventions", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { enabled: false } });
    }
    mutationCalls += 1;
    return route.fulfill({ status: 500, json: { error: "Mutation route must remain unused." } });
  });
  await page.route("**/api/hermes/health", (route) =>
    route.fulfill({
      json: {
        enabled: true,
        status: "online",
        version: "0.18.2",
        profile: "operator-os",
        gatewayState: "running",
        checkedAt: fixture.provenance.capturedAt,
        message: "Controlled browser contract.",
      },
    }),
  );
  await page.route("**/api/hermes/control-center", (route) => route.fulfill({ json: controlledProjection }));

  await page.goto(cabinet.appUrl + "/hermes");
  const useDefault = page.getByRole("button", { name: "Use default" });
  if (await useDefault.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await useDefault.click();
  }
  const skipTour = page.getByRole("button", { name: "Skip tour" });
  if (await skipTour.waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false)) {
    await skipTour.click();
  }
  await page.goto(cabinet.appUrl + "/hermes");
  await expect(page.getByTestId("hermes-control-center")).toBeVisible();
  return () => mutationCalls;
}

test.beforeAll(async () => {
  cabinet = await bootCabinet({
    env: {
      CABINET_RUNTIME_MODE: "hermes",
      CABINET_HERMES_PROFILE: "operator-os",
      CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
    },
  });
});

test.afterAll(async () => {
  await cabinet?.close();
});

test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page) ?? []).toEqual([]);
});

test("desktop preserves read-only runtime visibility while interventions are owner-disabled", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mutationCalls = await prepare(page);
  await page.getByTestId("hermes-runtime-run-list").getByRole("button").filter({ hasText: "Run 17" }).click();
  const inspector = page.locator('[data-testid="hermes-run-inspector"]:visible');
  await expect(inspector).toContainText("Run 17");
  await expect(inspector).toContainText("Owner enablement required");
  await expect(inspector.getByRole("button", { name: "Owner enablement required" })).toBeDisabled();
  expect(mutationCalls()).toBe(0);
});

test("390x844 reduced-motion view has no overflow and emits no mutation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  const mutationCalls = await prepare(page);
  await page.getByTestId("hermes-runtime-run-list").getByRole("button").filter({ hasText: "Run 17" }).click();
  await expect(page.locator('[data-testid="hermes-run-inspector"]:visible')).toContainText("Owner enablement required");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  expect(mutationCalls()).toBe(0);
});
