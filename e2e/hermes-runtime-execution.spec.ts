import { expect, test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildHermesRuntimeExecutionFixtureProjection, HERMES_RUNTIME_EXECUTION_FIXTURE_ID } from '../src/lib/hermes/control-center-runtime-fixture';
import { bootCabinet, type CabinetInstance } from '../test/support/harness';

test.describe.configure({ mode: 'serial' });
let cabinet: CabinetInstance;
const evidenceDir = path.resolve('docs/evidence/hermes-runtime-execution');
const implementationRevision = process.env.HERMES_EVIDENCE_IMPLEMENTATION_REVISION ?? '0'.repeat(40);
const artifactGeneratedAt = process.env.HERMES_EVIDENCE_GENERATED_AT ?? '2026-07-20T02:30:00.000Z';
const fixture = buildHermesRuntimeExecutionFixtureProjection({ implementationRevision, artifactGeneratedAt });
const browserErrors = new WeakMap<Page, string[]>();

async function prepare(page: Page) {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/hermes/health', (route) => route.fulfill({ json: { enabled: true, status: 'online', version: '0.18.2', profile: 'operator-os', gatewayState: 'running', checkedAt: fixture.provenance.capturedAt, message: 'Acceptance fixture health bridge.' } }));
  await page.route('**/api/hermes/control-center', (route) => route.fulfill({ json: fixture }));
  await page.goto(cabinet.appUrl + '/hermes');
  const useDefault = page.getByRole('button', { name: 'Use default' });
  if (await useDefault.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) await useDefault.click();
  const skipTour = page.getByRole('button', { name: 'Skip tour' });
  if (await skipTour.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) await skipTour.click();
  await page.goto(cabinet.appUrl + '/hermes');
  await page.addStyleTag({ content: '[aria-label=\"Status bar\"] { display: none !important; }' });
  await expect(page.getByTestId('hermes-control-center')).toBeVisible();
  await expect(page.getByTestId('hermes-fixture-provenance')).toContainText(HERMES_RUNTIME_EXECUTION_FIXTURE_ID);
  await expect(page.getByTestId('hermes-runtime-execution-overview')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(/fixture-secret|private-owner|customer@example|Authorization:|api_key|worker_pid|task_title/i);
}

async function selectRun(page: Page, name: string) {
  await page.getByTestId('hermes-runtime-run-list').getByRole('button').filter({ hasText: name }).click();
  await expect(page.locator('[data-testid="hermes-run-inspector"]:visible')).toBeVisible();
}

test.beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  cabinet = await bootCabinet({ env: { CABINET_RUNTIME_MODE: 'hermes', CABINET_HERMES_PROFILE: 'operator-os' } });
});
test.afterAll(async () => { await cabinet?.close(); });
test.afterEach(async ({ page }) => { expect(browserErrors.get(page) ?? []).toEqual([]); });

test('desktop runtime overview and run inspectors stay read-only and bounded', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  const overview = page.getByTestId('hermes-runtime-execution-overview');
  await expect(overview).toContainText('Hermes prepares; Jeremy commits.');
  await expect(overview).toContainText('Active');
  await expect(overview).toContainText('Waiting');
  await expect(overview).toContainText('Failed');
  await expect(overview).not.toContainText(/Approve|Reject|Cancel|Retry|Resume|Pause|Terminate/);
  await page.screenshot({ path: path.join(evidenceDir, 'runtime-execution-overview-1440x900.png'), fullPage: true });

  await selectRun(page, 'run-active');
  const active = page.getByTestId('hermes-run-inspector');
  await expect(active).toContainText('Gather evidence');
  await expect(active).toContainText('browser.read');
  await expect(active).toContainText('Child runs');
  await expect(active).toContainText('1');
  await page.screenshot({ path: path.join(evidenceDir, 'active-run-inspector.png'), fullPage: true });
  await page.screenshot({ path: path.join(evidenceDir, 'parent-child-run-view.png'), fullPage: true });

  await selectRun(page, 'run-approval');
  const waiting = page.getByTestId('hermes-run-inspector');
  await expect(waiting).toContainText('Waiting reason');
  await expect(waiting).toContainText('approval');
  await expect(waiting).toContainText('Run run-active');
  await page.screenshot({ path: path.join(evidenceDir, 'waiting-for-jeremy-inspector.png'), fullPage: true });

  await selectRun(page, 'run-failed');
  const failed = page.getByTestId('hermes-run-inspector');
  await expect(failed).toContainText('Run failed. A bounded failure summary is available.');
  await expect(failed).not.toContainText(/Bearer|fixture-secret|oversized oversized/);
  await page.screenshot({ path: path.join(evidenceDir, 'failed-run-inspector.png'), fullPage: true });

  await page.getByTestId('hermes-runtime-sources').getByRole('button').filter({ hasText: 'Agents' }).click();
  await page.getByRole('tab', { name: 'Developer' }).click();
  await page.getByTestId('hermes-capability-agents-subagents').click();
  const capability = page.getByTestId('hermes-capability-inspector');
  await expect(capability).toContainText('Hermes worker detail');
  await expect(capability).toContainText('Stale');
  await page.screenshot({ path: path.join(evidenceDir, 'stale-source-state.png'), fullPage: true });
});

test('390x844 mobile overview and run sheet have zero overflow under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(evidenceDir, 'mobile-runtime-overview-390x844.png'), fullPage: true });
  await selectRun(page, 'run-approval');
  await expect(page.getByRole('dialog')).toContainText('Hermes prepares; Jeremy commits.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: path.join(evidenceDir, 'mobile-run-inspector-390x844.png'), fullPage: true });
});
