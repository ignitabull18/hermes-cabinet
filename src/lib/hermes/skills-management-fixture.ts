import type { HermesSkillsAdapter } from "./skills-adapter";
import type { HermesManagedSkill, HermesSkillAction, HermesSkillOperation, HermesSkillsSnapshot, HermesSkillsSourceState } from "./skills-management-types";

export const HERMES_SKILLS_ACCEPTANCE_LABEL = "Acceptance fixture — no live Hermes mutation performed";

function installed(name: string, enabled: boolean, actions: HermesManagedSkill["supportedActions"], updateAvailable: boolean | null = null, hubIdentifier: string | null = null, source: string | null = null): HermesManagedSkill {
  const provenance = hubIdentifier ? "hub" : "bundled";
  return {
    identity: hubIdentifier ? `operator-os:hub:${hubIdentifier}` : `operator-os:${provenance}:${name}`,
    name,
    category: "fixture",
    installed: true,
    enabled,
    version: name === "update-ready" ? "1.0.0" : null,
    source: source ?? (hubIdentifier ? hubIdentifier.split("/")[0] : "bundled"),
    provenance,
    hubIdentifier,
    profile: "operator-os",
    updateAvailable,
    observedAt: "2026-07-21T20:00:00.000Z",
    supportedActions: actions,
  };
}

export function buildHermesSkillsAcceptanceSnapshot(): HermesSkillsSnapshot {
  return {
    fixture: true,
    fixtureLabel: HERMES_SKILLS_ACCEPTANCE_LABEL,
    profile: "operator-os",
    observedAt: "2026-07-21T20:00:00.000Z",
    sourceState: "success",
    summary: "Fixture covers governed Hermes Skills management without a live mutation.",
    interface: "Hermes Agent 0.19.0 authenticated API",
    operations: {
      install: { supported: true, interface: "fixture Hermes adapter", note: "No live dispatch." },
      enable: { supported: true, interface: "fixture Hermes adapter", note: "No live dispatch." },
      disable: { supported: true, interface: "fixture Hermes adapter", note: "No live dispatch." },
      update: { supported: false, interface: "fixture audit only", note: "Exact target-specific update readback is unavailable." },
      remove: { supported: true, interface: "fixture Hermes adapter", note: "No live dispatch." },
    },
    installed: [
      installed("enabled-skill", true, ["disable"]),
      installed("disabled-skill", false, ["enable"]),
      installed("update-ready", true, ["disable", "remove"], true, "official/productivity/update-ready", "official"),
      installed("removable-skill", true, ["disable", "remove"], false, "official/productivity/removable-skill", "official"),
      installed("unsupported-bundled", true, ["disable"]),
      installed("malicious-metadata-redacted", true, ["disable"]),
    ],
    available: [{
      identity: "official/productivity/installable-skill",
      name: "installable-skill",
      category: null,
      installed: false,
      enabled: null,
      version: null,
      source: "official",
      provenance: "hub",
      hubIdentifier: "official/productivity/installable-skill",
      profile: "operator-os",
      updateAvailable: null,
      observedAt: "2026-07-21T20:00:00.000Z",
      supportedActions: ["install"],
    }],
    duplicateIdentities: [],
  };
}

export class FakeHermesSkillsAdapter implements HermesSkillsAdapter {
  mutationCalls = 0;
  readonly operations: HermesSkillOperation[] = [];
  failBeforeDispatch = false;
  unknownAfterDispatch = false;
  staleOnNextRead = false;
  sourceStateOverride: HermesSkillsSourceState | null = null;
  observedAtOverride: string | null = null;
  executionBarrier: Promise<void> | null = null;
  executionStarted: (() => void) | null = null;
  installAsDifferentHubIdentity = false;
  leaveSameNameBundledOnRemove = false;
  private snapshotValue = buildHermesSkillsAcceptanceSnapshot();

  async read(): Promise<HermesSkillsSnapshot> {
    if (this.staleOnNextRead) {
      this.staleOnNextRead = false;
      const first = this.snapshotValue.installed[0];
      this.snapshotValue = { ...this.snapshotValue, observedAt: new Date().toISOString(), installed: [{ ...first, version: "externally-changed" }, ...this.snapshotValue.installed.slice(1)] };
    }
    const snapshot = structuredClone(this.snapshotValue);
    snapshot.observedAt = this.observedAtOverride ?? new Date().toISOString();
    snapshot.sourceState = this.sourceStateOverride ?? snapshot.sourceState;
    snapshot.installed = snapshot.installed.map((skill) => ({ ...skill, observedAt: snapshot.observedAt }));
    snapshot.available = snapshot.available.map((skill) => ({ ...skill, observedAt: snapshot.observedAt }));
    return snapshot;
  }

  async authorize(action: HermesSkillAction): Promise<string> {
    if (action === "update") throw new Error("Update remains audit-only");
    return `fixture-authority-${action}`;
  }

  async execute(operation: HermesSkillOperation, expectedAuthority: string): Promise<{ responseReceived: boolean }> {
    if (this.failBeforeDispatch) throw new Error("Fixture failed before dispatch");
    if (expectedAuthority !== `fixture-authority-${operation.action}`) throw new Error("Fixture authority mismatch");
    this.mutationCalls += 1;
    this.operations.push(operation);
    this.executionStarted?.();
    if (this.executionBarrier) await this.executionBarrier;
    if (this.unknownAfterDispatch) {
      const error = new Error("Fixture outcome unknown") as Error & { dispatched?: boolean };
      const { HermesSkillsAdapterError } = await import("./skills-adapter");
      throw new HermesSkillsAdapterError("timeout", error.message, true, false);
    }
    if (operation.action === "install") {
      const catalog = this.snapshotValue.available.find((skill) => skill.identity === operation.targetIdentity);
      this.snapshotValue.available = this.snapshotValue.available.filter((skill) => skill.identity !== operation.targetIdentity);
      const installedIdentifier = this.installAsDifferentHubIdentity ? `clawhub/${operation.targetName}` : operation.targetIdentity;
      this.snapshotValue.installed.push(installed(operation.targetName, true, ["disable", "remove"], false, installedIdentifier, this.installAsDifferentHubIdentity ? "clawhub" : catalog?.source ?? null));
    } else if (operation.action === "remove") {
      this.snapshotValue.installed = this.snapshotValue.installed.filter((skill) => skill.identity !== operation.targetIdentity);
      if (this.leaveSameNameBundledOnRemove) this.snapshotValue.installed.push(installed(operation.targetName, true, ["disable"]));
    } else {
      this.snapshotValue.installed = this.snapshotValue.installed.map((skill) => skill.name === operation.targetName ? {
        ...skill,
        enabled: operation.action === "enable" ? true : operation.action === "disable" ? false : skill.enabled,
        supportedActions: operation.action === "enable"
          ? ["disable", ...(skill.provenance === "hub" ? ["remove" as const] : [])]
          : operation.action === "disable"
            ? ["enable", ...(skill.provenance === "hub" ? ["remove" as const] : [])]
            : skill.supportedActions,
      } : skill);
    }
    this.snapshotValue.observedAt = new Date().toISOString();
    return { responseReceived: true };
  }
}
