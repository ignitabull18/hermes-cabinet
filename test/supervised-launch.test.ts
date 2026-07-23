import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateSupervisedEnvironment } from "../scripts/start-cabinet-supervised.mjs";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-launch-test-"));
  const data = path.join(root, "data");
  const cli = path.join(root, "hermes");
  const envFile = path.join(root, "cabinet.env");
  fs.mkdirSync(path.join(root, ".next", "standalone"), { recursive: true });
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(root, ".next", "standalone", "server.js"), "");
  fs.writeFileSync(cli, "");
  fs.chmodSync(cli, 0o700);
  fs.writeFileSync(envFile, "CABINET_AUTH_SALT=fixture\n", { mode: 0o600 });
  return { root, data, cli, envFile };
}

test("supervised launch accepts only the private Hermes production contract", () => {
  const item = fixture();
  try {
    const result = validateSupervisedEnvironment({
      CABINET_DATA_DIR: item.data,
      CABINET_RUNTIME_MODE: "hermes",
      CABINET_HERMES_EXECUTION_CLI_PATH: item.cli,
      CABINET_HERMES_PROFILE: "operator-os",
      CABINET_ENV_FILE: item.envFile,
      CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
      HOSTNAME: "127.0.0.1",
      PORT: "4012",
    }, item.root);
    assert.equal(result.port, 4012);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("supervised launch rejects public listeners and enabled interventions", () => {
  const item = fixture();
  const base = {
    CABINET_DATA_DIR: item.data,
    CABINET_RUNTIME_MODE: "hermes",
    CABINET_HERMES_EXECUTION_CLI_PATH: item.cli,
    CABINET_HERMES_PROFILE: "operator-os",
    CABINET_ENV_FILE: item.envFile,
    CABINET_HERMES_INTERVENTIONS_ENABLED: "false",
    HOSTNAME: "127.0.0.1",
    PORT: "4012",
  };
  try {
    assert.throws(() => validateSupervisedEnvironment({ ...base, HOSTNAME: "0.0.0.0" }, item.root), /loopback-only/);
    assert.throws(() => validateSupervisedEnvironment({ ...base, CABINET_HERMES_INTERVENTIONS_ENABLED: "true" }, item.root), /interventions disabled/);
  } finally {
    fs.rmSync(item.root, { recursive: true, force: true });
  }
});

test("launchd template contains no secret values or shell execution", () => {
  const template = fs.readFileSync(path.resolve("deploy/macos/ai.cabinet.plist.template"), "utf8");
  assert.match(template, /127\.0\.0\.1/);
  assert.match(template, /CABINET_HERMES_INTERVENTIONS_ENABLED/);
  assert.match(template, /CABINET_ENV_FILE/);
  assert.doesNotMatch(template, /API_KEY|TOKEN|PASSWORD|\/bin\/sh|-c<\/string>/);
});
