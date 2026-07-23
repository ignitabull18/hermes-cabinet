import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const resultPath = path.resolve(
  import.meta.dirname,
  "../../docs/research/parallel/acp-production-differential/result.json",
);

test("differential result contains the required decision evidence", () => {
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  assert.equal(result.liveDiagnostic.attempts, 1);
  assert.equal(result.liveDiagnostic.followUpsSent, 0);
  assert.equal(result.liveDiagnostic.port, 4301);
  assert.equal(result.liveDiagnostic.exitCode, 124);
  assert.equal(result.exactExit124Producer.operation, "official SDK agent.initialize request");
  assert.equal(result.sharedCoreFinding.usesSameCore, false);
  assert.equal(result.minimumProductionChange.initializationTimeoutMs, 120000);
  assert.ok(result.liveDiagnostic.absentStages.includes("prompt_dispatched"));
  assert.equal(result.safety.productionPort4000Touched, false);
});

test("artifact contains no raw frame or private-home path fields", () => {
  const text = fs.readFileSync(resultPath, "utf8");
  assert.doesNotMatch(text, /rawFrame|rawPrompt|environmentDump/);
  assert.doesNotMatch(text, /\/Users\//);
});
