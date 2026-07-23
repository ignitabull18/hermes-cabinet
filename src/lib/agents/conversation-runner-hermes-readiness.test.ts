import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { agentAdapterRegistry } from "./adapters/registry";

test("initial Hermes readiness blocks before conversation persistence or prompt dispatch", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "cabinet-hermes-initial-"));
  const previousDataDir = process.env.CABINET_DATA_DIR;
  process.env.CABINET_DATA_DIR = dataDir;
  let executions = 0;
  try {
    const store = await import("./conversation-store");
    const runner = await import("./conversation-runner");
    agentAdapterRegistry.registerExternal({
      type: "hermes_runtime",
      name: "Hermes blocked initial fixture",
      executionEngine: "structured_cli",
      providerId: "hermes",
      supportsSessionResume: true,
      async testEnvironment() {
        return {
          adapterType: "hermes_runtime",
          status: "fail",
          checks: [],
          testedAt: new Date().toISOString(),
        };
      },
      async preflight() {
        throw new Error("No effective Hermes model is configured for operator-os.");
      },
      async execute() {
        executions += 1;
        throw new Error("must not execute");
      },
    });
    await assert.rejects(
      () => runner.startConversationRun({
        agentSlug: "general",
        title: "Blocked initial readiness",
        trigger: "manual",
        prompt: "must not persist",
        providerId: "hermes",
        adapterType: "hermes_runtime",
        cwd: dataDir,
      }),
      /No effective Hermes model is configured for operator-os/,
    );
    assert.equal(executions, 0);
    assert.equal((await store.listConversationMetas()).length, 0);
    await store.closeConversationStore();
  } finally {
    agentAdapterRegistry.unregisterExternal("hermes_runtime");
    if (previousDataDir === undefined) delete process.env.CABINET_DATA_DIR;
    else process.env.CABINET_DATA_DIR = previousDataDir;
    await fs.rm(dataDir, { recursive: true, force: true });
  }
});
