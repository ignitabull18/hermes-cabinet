import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const cabinetRepository = path.resolve(import.meta.dirname, "../..");
const integrationRoot = path.join(
  os.homedir(),
  "projects/worktrees/hermes-cabinet-integration/production-stabilization-v2",
);

test("source chain proves initialize timeout maps to exit 124", () => {
  const config = fs.readFileSync(
    path.join(integrationRoot, "src/lib/hermes/server-config.ts"),
    "utf8",
  );
  const client = fs.readFileSync(
    path.join(integrationRoot, "src/lib/hermes/acp-client.ts"),
    "utf8",
  );
  const adapter = fs.readFileSync(
    path.join(integrationRoot, "src/lib/agents/adapters/hermes-runtime.ts"),
    "utf8",
  );
  assert.match(config, /if \(!value\?\.trim\(\)\) return 3_000/);
  assert.match(
    client,
    /connection\.agent\.request\(acp\.methods\.agent\.initialize[\s\S]*?this\.config\.timeoutMs/,
  );
  assert.match(adapter, /exitCode: classification\.kind === "timeout" \? 124 : 1/);
});

test("passing probe and production client are separate implementations", () => {
  const probe = execFileSync(
    "git",
    [
      "show",
      "research/persistent-acp-sdk-transport:experiments/transports/acp-sdk/src/probe.ts",
    ],
    { cwd: cabinetRepository, encoding: "utf8" },
  );
  const client = fs.readFileSync(
    path.join(integrationRoot, "src/lib/hermes/acp-client.ts"),
    "utf8",
  );
  assert.match(probe, /export class PersistentAcpSdkProbe/);
  assert.match(client, /class PersistentHermesAcpClient/);
  assert.doesNotMatch(client, /PersistentAcpSdkProbe/);
});
