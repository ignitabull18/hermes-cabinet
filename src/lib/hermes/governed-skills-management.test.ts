import assert from "node:assert/strict";
import test from "node:test";
import { HermesSkillsManagementService } from "./governed-skills-management";
import { FakeHermesSkillsAdapter } from "./skills-management-fixture";
import type { HermesSkillAction } from "./skills-management-types";

const actor = "cabinet-test-actor";
const actorB = "cabinet-test-actor-b";
const reason = "Required for the governed acceptance test.";
const enabledIdentity = "operator-os:bundled:enabled-skill";
const disabledIdentity = "operator-os:bundled:disabled-skill";
const removableIdentity = "operator-os:hub:official/productivity/removable-skill";
const installIdentity = "official/productivity/installable-skill";

function opaqueSequence() {
  let value = 0;
  return () => (++value).toString(16).padStart(32, "0");
}

function service(adapter = new FakeHermesSkillsAdapter(), now: () => Date = () => new Date(), options: ConstructorParameters<typeof HermesSkillsManagementService>[2] = {}) {
  return new HermesSkillsManagementService(adapter, now, { opaqueToken: opaqueSequence(), ...options });
}

async function prepare(target: HermesSkillsManagementService, action: HermesSkillAction, targetIdentity: string, actorIdentity = actor, query = "") {
  return target.prepare({ action, targetIdentity, reason, actorIdentity, query });
}

async function commit(target: HermesSkillsManagementService, preview: Awaited<ReturnType<typeof prepare>>, actorIdentity = actor) {
  return target.commit({ previewId: preview.previewId, targetIdentity: preview.targetIdentity, confirmationPhrase: preview.confirmationPhrase, actorIdentity });
}

test("every prepare receives independent 128-bit preview and request identities", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const first = await prepare(target, "disable", enabledIdentity);
  const second = await prepare(target, "disable", enabledIdentity);
  assert.equal(adapter.mutationCalls, 0);
  assert.match(first.previewId, /^hermes-preview-[a-f0-9]{32}$/);
  assert.match(first.requestIdentity, /^hermes-request-[a-f0-9]{32}$/);
  assert.notEqual(first.previewId, first.requestIdentity);
  assert.notEqual(first.previewId, second.previewId);
  assert.notEqual(first.requestIdentity, second.requestIdentity);
  assert.equal(first.confirmationPhrase, "DISABLE SKILL enabled-skill IN operator-os");
});

test("commit requires exact phrase, actor, and exact target binding", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const preview = await prepare(target, "disable", enabledIdentity);
  await assert.rejects(() => target.commit({ previewId: preview.previewId, targetIdentity: preview.targetIdentity, confirmationPhrase: "confirmed", actorIdentity: actor }), /exact server-issued/i);
  await assert.rejects(() => target.commit({ previewId: preview.previewId, targetIdentity: "operator-os:bundled:other", confirmationPhrase: preview.confirmationPhrase, actorIdentity: actor }), /does not match/i);
  await assert.rejects(() => target.commit({ previewId: preview.previewId, targetIdentity: preview.targetIdentity, confirmationPhrase: preview.confirmationPhrase, actorIdentity: actorB }), /unavailable/i);
  assert.equal(adapter.mutationCalls, 0);
});

test("actors have isolated previews and completed receipts", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const previewA = await prepare(target, "disable", enabledIdentity, actor);
  const resultA = await commit(target, previewA, actor);
  assert.equal(resultA.status, "verified_success");
  await assert.rejects(() => commit(target, previewA, actorB), /unavailable/i);
  const previewB = await prepare(target, "enable", enabledIdentity, actorB);
  assert.notEqual(previewB.requestIdentity, previewA.requestIdentity);
  assert.equal(adapter.mutationCalls, 1);
});

test("unsupported action and changed semantic state block before dispatch", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  await assert.rejects(() => prepare(target, "remove", "operator-os:bundled:unsupported-bundled"), /does not support/i);
  await assert.rejects(() => prepare(target, "update", "operator-os:hub:official/productivity/update-ready"), /does not support/i);
  const preview = await prepare(target, "disable", enabledIdentity);
  adapter.staleOnNextRead = true;
  const result = await commit(target, preview);
  assert.equal(result.status, "blocked_no_action");
  assert.match(result.summary, /state changed/i);
  assert.equal(adapter.mutationCalls, 0);
});

test("canonical unavailable, authentication, timeout, failure, malformed, and stale states fail before dispatch honestly", async () => {
  for (const state of ["unavailable", "authentication_failure", "timeout", "failure", "malformed"] as const) {
    const adapter = new FakeHermesSkillsAdapter();
    const target = service(adapter);
    const preview = await prepare(target, "disable", enabledIdentity);
    adapter.sourceStateOverride = state;
    const result = await commit(target, preview);
    assert.equal(result.status, "failed_before_dispatch", state);
    assert.match(result.summary, new RegExp(state));
    assert.doesNotMatch(result.summary, /target changed/i);
    assert.equal(adapter.mutationCalls, 0);
  }

  const adapter = new FakeHermesSkillsAdapter();
  let now = Date.now();
  const target = service(adapter, () => new Date(now), { canonicalFreshnessMs: 1_000 });
  const preview = await prepare(target, "disable", enabledIdentity);
  now += 2_000;
  adapter.observedAtOverride = new Date(now - 2_000).toISOString();
  const stale = await commit(target, preview);
  assert.equal(stale.status, "failed_before_dispatch");
  assert.match(stale.summary, /stale/i);
  assert.equal(adapter.mutationCalls, 0);
});

test("concurrent duplicates for one preview dispatch exactly once and reuse the completed receipt", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const preview = await prepare(target, "disable", enabledIdentity);
  const [first, second] = await Promise.all([commit(target, preview), commit(target, preview)]);
  assert.deepEqual(first, second);
  assert.equal(first.status, "verified_success");
  assert.equal(adapter.mutationCalls, 1);
  assert.deepEqual(await commit(target, preview), first);
  assert.equal(adapter.mutationCalls, 1);
});

test("pending receipts survive count overflow, retention cleanup, and concurrent duplicate cleanup", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  let releaseExecution!: () => void;
  adapter.executionBarrier = new Promise<void>((resolve) => { releaseExecution = resolve; });
  let executionStarted!: () => void;
  const started = new Promise<void>((resolve) => { executionStarted = resolve; });
  adapter.executionStarted = executionStarted;
  let now = Date.now();
  const target = service(adapter, () => new Date(now), { maxReceipts: 1, receiptRetentionMs: 10, canonicalFreshnessMs: 1_000_000 });
  const pendingPreview = await prepare(target, "disable", enabledIdentity);
  const pendingCommit = commit(target, pendingPreview);
  await started;
  now += 50;
  const duplicateDuringCleanup = commit(target, pendingPreview);
  const secondPreview = await prepare(target, "enable", disabledIdentity);
  adapter.executionBarrier = null;
  const second = await commit(target, secondPreview);
  assert.equal(second.status, "verified_success");
  assert.deepEqual(await commit(target, secondPreview), second, "a pending receipt must not consume the completed-receipt count budget");
  releaseExecution();
  const [first, duplicate] = await Promise.all([pendingCommit, duplicateDuringCleanup]);
  assert.deepEqual(first, duplicate);
  assert.equal(adapter.mutationCalls, 2, "cleanup must not cause a second pending dispatch");
});

test("completed receipt eviction removes its preview and cannot redispatch", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter, () => new Date(), { maxReceipts: 1, receiptRetentionMs: 1_000_000 });
  const firstPreview = await prepare(target, "disable", enabledIdentity);
  assert.equal((await commit(target, firstPreview)).status, "verified_success");
  const secondPreview = await prepare(target, "enable", disabledIdentity);
  assert.equal((await commit(target, secondPreview)).status, "verified_success");
  const calls = adapter.mutationCalls;
  await assert.rejects(() => commit(target, firstPreview), /unavailable|prepare it again/i);
  assert.equal(adapter.mutationCalls, calls);
});

test("enable, disable, then enable with the same reason executes the new required operation", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const enableOne = await prepare(target, "enable", disabledIdentity);
  assert.equal((await commit(target, enableOne)).status, "verified_success");
  const disable = await prepare(target, "disable", disabledIdentity);
  assert.equal((await commit(target, disable)).status, "verified_success");
  const enableTwo = await prepare(target, "enable", disabledIdentity);
  assert.notEqual(enableOne.requestIdentity, enableTwo.requestIdentity);
  const final = await commit(target, enableTwo);
  assert.equal(final.status, "verified_success");
  assert.equal(final.mutationAttempted, true);
  assert.equal(adapter.mutationCalls, 3);
});

test("Hermes exact readback is required for install, enable, disable, and removal", async () => {
  const cases: Array<[HermesSkillAction, string, string]> = [
    ["install", installIdentity, "installable-skill"],
    ["enable", disabledIdentity, "disabled-skill"],
    ["disable", enabledIdentity, "enabled-skill"],
    ["remove", removableIdentity, "removable-skill"],
  ];
  for (const [action, identity, name] of cases) {
    const adapter = new FakeHermesSkillsAdapter();
    const target = service(adapter);
    const result = await commit(target, await prepare(target, action, identity));
    assert.equal(result.status, "verified_success", action);
    assert.equal(result.targetName, name);
    assert.equal(result.mutationAttempted, true);
    assert.equal(adapter.mutationCalls, 1);
  }
});

test("same-name skill from another source cannot verify install, while exact removal tolerates a bundled name collision", async () => {
  const wrongInstall = new FakeHermesSkillsAdapter();
  wrongInstall.installAsDifferentHubIdentity = true;
  const installService = service(wrongInstall);
  const installed = await commit(installService, await prepare(installService, "install", installIdentity));
  assert.equal(installed.status, "outcome_unknown");

  const removal = new FakeHermesSkillsAdapter();
  removal.leaveSameNameBundledOnRemove = true;
  const removalService = service(removal);
  const removed = await commit(removalService, await prepare(removalService, "remove", removableIdentity));
  assert.equal(removed.status, "verified_success");
});

test("failure before dispatch and timeout after dispatch preserve outcome certainty", async () => {
  const beforeAdapter = new FakeHermesSkillsAdapter();
  beforeAdapter.failBeforeDispatch = true;
  const beforeService = service(beforeAdapter);
  const before = await commit(beforeService, await prepare(beforeService, "disable", enabledIdentity));
  assert.equal(before.status, "failed_before_dispatch");
  assert.equal(before.mutationAttempted, false);

  const unknownAdapter = new FakeHermesSkillsAdapter();
  unknownAdapter.unknownAfterDispatch = true;
  const unknownService = service(unknownAdapter);
  const preview = await prepare(unknownService, "disable", enabledIdentity);
  const unknown = await commit(unknownService, preview);
  assert.equal(unknown.status, "outcome_unknown");
  assert.equal(unknown.mutationAttempted, true);
  const calls = unknownAdapter.mutationCalls;
  await unknownService.recheck({ previewId: preview.previewId, targetIdentity: preview.targetIdentity, actorIdentity: actor });
  assert.equal(unknownAdapter.mutationCalls, calls, "read-only reconciliation must never repeat a mutation");
});

test("a process-restart replay cannot repeat an operation exact canonical Hermes state already proves", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const firstProcess = service(adapter);
  const restartedProcess = service(adapter);
  const firstPreview = await prepare(firstProcess, "enable", disabledIdentity);
  const restartPreview = await prepare(restartedProcess, "enable", disabledIdentity);
  assert.equal((await commit(firstProcess, firstPreview)).status, "verified_success");
  assert.equal(adapter.mutationCalls, 1);
  const replay = await commit(restartedProcess, restartPreview);
  assert.equal(replay.status, "verified_success");
  assert.equal(replay.mutationAttempted, false);
  assert.equal(adapter.mutationCalls, 1);
});

test("actor identity, state fingerprint, and credentials never egress", async () => {
  const adapter = new FakeHermesSkillsAdapter();
  const target = service(adapter);
  const preview = await target.prepare({ action: "disable", targetIdentity: enabledIdentity, reason, actorIdentity: "actor-secret-value" });
  const result = await commit(target, preview, "actor-secret-value");
  const serialized = JSON.stringify({ preview, result });
  for (const forbidden of ["actor-secret-value", "stateFingerprint", "authorityIdentity", "credential", "apiKey"]) assert.doesNotMatch(serialized, new RegExp(forbidden, "i"));
});
