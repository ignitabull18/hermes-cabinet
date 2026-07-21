import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { observeHermesLocalMemory, SUPERMEMORY_LIMITATION } from "./local-memory-observation";

async function fixture(input: { provider?: string; credential?: boolean; plugin?: boolean }) {
  const root = await mkdtemp(path.join(tmpdir(), "cabinet-hermes-memory-"));
  const profileRoot = path.join(root, "profiles", "operator-os");
  await mkdir(profileRoot, { recursive: true });
  await writeFile(path.join(profileRoot, "config.yaml"), `memory:\n  provider: ${input.provider ?? "supermemory"}\n`, "utf8");
  if (input.credential) await writeFile(path.join(root, ".env"), "SUPERMEMORY_API_KEY=never-return-this-value\n", "utf8");
  if (input.plugin) {
    const pluginRoot = path.join(root, "hermes-agent", "plugins", "memory", "supermemory");
    await mkdir(pluginRoot, { recursive: true });
    await writeFile(path.join(pluginRoot, "plugin.yaml"), "name: supermemory\n", "utf8");
  }
  return root;
}

test("reports configured Supermemory without returning its credential or local path", async () => {
  const root = await fixture({ credential: true, plugin: true });
  try {
    const result = await observeHermesLocalMemory("operator-os", { hermesHome: root, observedAt: "2026-07-21T12:00:00.000Z" });
    assert.equal(result.state, "configured");
    assert.equal(result.summary, SUPERMEMORY_LIMITATION);
    assert.equal(result.liveDataExposed, false);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /never-return-this-value/);
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(serialized, /SUPERMEMORY_API_KEY/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("does not call a selected provider configured until plugin and credential metadata agree", async () => {
  const root = await fixture({ credential: false, plugin: true });
  try {
    const result = await observeHermesLocalMemory("operator-os", { hermesHome: root });
    assert.equal(result.state, "not_configured");
    assert.equal(result.provider, "supermemory");
    assert.equal(result.credentialConfigured, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid profile identities fail closed without reading outside the Hermes profile root", async () => {
  const result = await observeHermesLocalMemory("../owner", { hermesHome: "/private/should-not-be-read" });
  assert.equal(result.state, "unknown");
  assert.equal(result.profile, "unknown");
});
