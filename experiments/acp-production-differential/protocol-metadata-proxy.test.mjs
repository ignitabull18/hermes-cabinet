import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("trace records only bounded metadata", () => {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, "protocol-metadata-proxy.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /frame\.(params\.)?prompt/);
  assert.doesNotMatch(source, /content\.text/);
  assert.doesNotMatch(source, /process\.env\)/);
  const allowed = new Set([
    "sequence",
    "elapsedMs",
    "stage",
    "direction",
    "signal",
    "exitCode",
  ]);
  const sample = {
    sequence: 1,
    elapsedMs: 1.2,
    stage: "child_spawn_started",
  };
  assert.deepEqual(Object.keys(sample).filter((key) => !allowed.has(key)), []);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "acp-trace-test-"));
  fs.rmSync(temp, { recursive: true });
});
