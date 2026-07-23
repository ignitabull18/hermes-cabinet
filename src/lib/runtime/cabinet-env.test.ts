import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cabinetEnvPath } from "./cabinet-env";

test("explicit Cabinet environment file is absolute, regular, owner-only, and not a symlink", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cabinet-env-file-test-"));
  const envFile = path.join(root, "cabinet.env");
  const link = path.join(root, "cabinet.env.link");
  const previous = process.env.CABINET_ENV_FILE;
  try {
    fs.writeFileSync(envFile, "CABINET_AUTH_SALT=fixture\n", { mode: 0o600 });
    process.env.CABINET_ENV_FILE = envFile;
    assert.equal(cabinetEnvPath(), envFile);

    fs.chmodSync(envFile, 0o640);
    assert.throws(() => cabinetEnvPath(), /group or other access/);
    fs.chmodSync(envFile, 0o600);

    fs.symlinkSync(envFile, link);
    process.env.CABINET_ENV_FILE = link;
    assert.throws(() => cabinetEnvPath(), /regular file, not a symlink/);

    process.env.CABINET_ENV_FILE = "relative.env";
    assert.throws(() => cabinetEnvPath(), /absolute path/);
  } finally {
    if (previous === undefined) delete process.env.CABINET_ENV_FILE;
    else process.env.CABINET_ENV_FILE = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
