import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { observeHermesLocalMemory, SUPERMEMORY_LIMITATION } from "./local-memory-observation";

async function fixture(provider = "supermemory") {
  const root = await mkdtemp(path.join(tmpdir(), "cabinet-hermes-memory-"));
  const profileRoot = path.join(root, "profiles", "operator-os");
  await mkdir(profileRoot, { recursive: true });
  await writeFile(path.join(profileRoot, "config.yaml"), `memory:\n  provider: ${provider}\n`, "utf8");
  const pluginRoot = path.join(root, "hermes-agent", "plugins", "memory", "supermemory");
  await mkdir(pluginRoot, { recursive: true });
  await writeFile(path.join(pluginRoot, "plugin.yaml"), "name: supermemory\n", "utf8");
  await writeFile(path.join(root, ".env"), "SUPERMEMORY_API_KEY=never-read-this-value\n", "utf8");
  await writeFile(path.join(profileRoot, ".env"), "SUPERMEMORY_API_KEY=never-read-this-profile-value\n", "utf8");
  return root;
}

test("reports only configured-profile and plugin-manifest metadata", async () => {
  const root = await fixture();
  try {
    const result = await observeHermesLocalMemory("operator-os", { hermesHome: root, observedAt: "2026-07-21T12:00:00.000Z" });
    assert.equal(result.state, "metadata_detected");
    assert.equal(result.summary, SUPERMEMORY_LIMITATION);
    assert.equal(result.configuredProviderSelection, "supermemory");
    assert.equal(result.detectedPluginManifest, true);
    assert.equal(result.observedLoadedProvider, null);
    assert.equal(result.observedRuntimeAvailability, "unknown");
    assert.equal(result.credentialState, "not_inspected");
    assert.equal(result.liveDataExposed, false);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /never-read-this/);
    assert.doesNotMatch(serialized, /credentialConfigured/);
    assert.doesNotMatch(serialized, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("never attempts to read Hermes environment files", async () => {
  const requested: string[] = [];
  const result = await observeHermesLocalMemory("operator-os", {
    hermesHome: "/safe/hermes",
    readText: async (file) => {
      requested.push(file);
      if (file.endsWith("config.yaml")) return "memory:\n  provider: supermemory\n";
      throw new Error("secret file read attempted");
    },
    fileExists: async (file) => {
      requested.push(file);
      return file.endsWith("plugin.yaml");
    },
  });
  assert.equal(result.state, "metadata_detected");
  assert.equal(requested.some((file) => path.basename(file) === ".env"), false);
  assert.deepEqual(requested.map((file) => path.basename(file)), ["config.yaml", "plugin.yaml"]);
});

test("provider selection is not runtime availability", async () => {
  const root = await fixture("other-provider");
  try {
    const result = await observeHermesLocalMemory("operator-os", { hermesHome: root });
    assert.equal(result.state, "not_selected");
    assert.equal(result.configuredProviderSelection, null);
    assert.equal(result.observedRuntimeAvailability, "unknown");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid profile identities fail closed without reading outside the Hermes profile root", async () => {
  const result = await observeHermesLocalMemory("../owner", { hermesHome: "/private/should-not-be-read" });
  assert.equal(result.state, "unknown");
  assert.equal(result.configuredProfile, "unknown");
});
