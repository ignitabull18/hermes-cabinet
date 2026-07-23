#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { validateReadiness } from "./differential.mjs";

const required = [
  "PASSING_SOURCE_ROOT",
  "PASSING_PYTHON",
  "FAILING_SOURCE_ROOT",
  "FAILING_PYTHON",
];
for (const name of required) {
  if (!process.env[name] || !path.isAbsolute(process.env[name])) {
    throw new Error(`${name} must be an absolute path`);
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "acp-provider-readiness-"));
const probe = path.join(import.meta.dirname, "readiness_probe.py");

function runCase({ sourceRoot, python, explicitHermesHome }) {
  const home = path.join(root, explicitHermesHome ? "passing-home" : "failing-home");
  const configuredHome = path.join(home, ".hermes-cabinet-acp");
  fs.mkdirSync(configuredHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    path.join(configuredHome, "config.yaml"),
    "model:\n  default: glm-5.2\n  provider: ollama-cloud\n",
    { mode: 0o600 },
  );
  const env = {
    HOME: home,
    HERMES_PROFILE: "operator-os",
    OLLAMA_API_KEY: "diagnostic-presence-marker",
    PATH: process.env.PATH,
    LANG: process.env.LANG,
  };
  if (explicitHermesHome) env.HERMES_HOME = configuredHome;
  const completed = spawnSync(python, [probe], {
    cwd: sourceRoot,
    env,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (completed.status !== 0) {
    throw new Error("readiness probe failed before producing a safe result");
  }
  return validateReadiness(JSON.parse(completed.stdout));
}

try {
  const result = {
    contract: "cabinet.acp.provider-model-differential",
    schemaVersion: 1,
    modelRequests: 0,
    providerCompletions: 0,
    promptDispatches: 0,
    passingStandalone: runCase({
      sourceRoot: process.env.PASSING_SOURCE_ROOT,
      python: process.env.PASSING_PYTHON,
      explicitHermesHome: true,
    }),
    failingIntegrated: runCase({
      sourceRoot: process.env.FAILING_SOURCE_ROOT,
      python: process.env.FAILING_PYTHON,
      explicitHermesHome: false,
    }),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
