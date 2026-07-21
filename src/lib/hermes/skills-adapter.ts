import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { sanitizeHermesText } from "./control-center-sanitizer";
import type { HermesReadOnlyServerConfig } from "./server-config";
import type {
  HermesManagedSkill,
  HermesSkillAction,
  HermesSkillOperation,
  HermesSkillsSnapshot,
  HermesSkillsSourceState,
} from "./skills-management-types";

type Fetch = typeof fetch;

const AUDITED_HERMES_VERSION = "0.19.0";
const SAFE_NAME = /^[a-z][a-z0-9_-]{0,95}$/;
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*){0,6}$/;
const MAX_OUTPUT_BYTES = 128 * 1024;
const MAX_EXECUTABLE_BYTES = 16 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;
const HARD_SETTLEMENT_SLACK_MS = 1_000;

export type HermesCliAuthority = {
  opaqueIdentity: string;
  version: typeof AUDITED_HERMES_VERSION;
};

export type CliResult = {
  exitCode: number | null;
  timedOut: boolean;
  forcedTermination: boolean;
  output: string;
};

export type HermesSkillsCli = {
  configured(): boolean;
  inspect(): Promise<HermesCliAuthority>;
  run(args: readonly string[], options?: { input?: string; timeoutMs?: number; expectedAuthority?: string }): Promise<CliResult>;
};

export type HermesSkillsAdapter = {
  read(query?: string): Promise<HermesSkillsSnapshot>;
  authorize(action: HermesSkillAction): Promise<string>;
  execute(operation: HermesSkillOperation, expectedAuthority: string): Promise<{ responseReceived: boolean }>;
};

export class HermesSkillsAdapterError extends Error {
  constructor(
    readonly kind: "unavailable" | "authentication" | "timeout" | "invalid_response" | "contract_mismatch" | "dispatch_failed",
    message: string,
    readonly dispatched = false,
    readonly responseReceived = false,
  ) {
    super(message);
    this.name = "HermesSkillsAdapterError";
  }
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function safeName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return SAFE_NAME.test(candidate) ? candidate : null;
}

function safeIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  return SAFE_IDENTIFIER.test(candidate) ? candidate : null;
}

function safeLabel(value: unknown, max = 64): string | null {
  if (typeof value !== "string") return null;
  const clean = sanitizeHermesText(value, max).replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean || clean.includes("[redacted") || /(?:https?|file):\/\//i.test(clean) || /^(?:[a-z]:[\\/]|[/~\\])/i.test(clean)) return null;
  return clean;
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function uniqueSkills(items: HermesManagedSkill[]): { items: HermesManagedSkill[]; duplicates: string[] } {
  const seen = new Map<string, HermesManagedSkill>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item.identity)) duplicates.add(item.identity);
    else seen.set(item.identity, item);
  }
  return { items: [...seen.values()], duplicates: [...duplicates] };
}

function installedIdentity(profile: string, name: string, provenance: HermesManagedSkill["provenance"], hubIdentifier: string | null): string {
  if (provenance === "hub" && hubIdentifier) return `${profile}:hub:${hubIdentifier}`;
  return `${profile}:${provenance ?? "unknown"}:${name}`;
}

function supportedActions(
  skill: Pick<HermesManagedSkill, "installed" | "enabled" | "provenance" | "hubIdentifier">,
  cliConfigured: boolean,
): HermesSkillAction[] {
  if (!skill.installed) return cliConfigured ? ["install"] : [];
  const actions: HermesSkillAction[] = skill.enabled === false ? ["enable"] : skill.enabled === true ? ["disable"] : [];
  if (skill.provenance === "hub" && skill.hubIdentifier && cliConfigured) actions.push("remove");
  return actions;
}

export function hermesCliChildEnvironment(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    HOME: homedir(),
    PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    HERMES_NONINTERACTIVE: "1",
    NO_COLOR: "1",
    TERM: "dumb",
  };
}

function runBoundedProcess(
  executable: string,
  args: readonly string[],
  options: { input?: string; timeoutMs: number; terminationGraceMs: number },
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, [...args], {
        shell: false,
        windowsHide: true,
        env: hermesCliChildEnvironment(),
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (error) {
      reject(new HermesSkillsAdapterError("dispatch_failed", error instanceof Error ? error.message : "Hermes CLI could not start."));
      return;
    }

    let settled = false;
    let spawned = false;
    let timedOut = false;
    let forcedTermination = false;
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let terminationTimer: NodeJS.Timeout | null = null;
    let hardTimer: NodeJS.Timeout | null = null;

    const clearTimers = () => {
      clearTimeout(operationTimer);
      if (terminationTimer) clearTimeout(terminationTimer);
      if (hardTimer) clearTimeout(hardTimer);
    };
    const closeStreams = () => {
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    };
    const finish = (result: CliResult) => {
      if (settled) return;
      settled = true;
      clearTimers();
      closeStreams();
      resolve(result);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      closeStreams();
      reject(error);
    };
    const append = (chunk: Buffer | string) => {
      if (settled || outputBytes >= MAX_OUTPUT_BYTES) return;
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const bounded = value.subarray(0, MAX_OUTPUT_BYTES - outputBytes);
      chunks.push(bounded);
      outputBytes += bounded.byteLength;
    };
    const output = () => Buffer.concat(chunks).toString("utf8");

    child.once("spawn", () => { spawned = true; });
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", (error) => {
      fail(new HermesSkillsAdapterError("dispatch_failed", error.message, spawned, false));
    });
    child.once("close", (exitCode) => {
      finish({ exitCode, timedOut, forcedTermination, output: output() });
    });

    if (options.input) child.stdin?.end(options.input);
    else child.stdin?.end();

    const operationTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      child.kill("SIGTERM");
      terminationTimer = setTimeout(() => {
        if (settled) return;
        forcedTermination = true;
        child.kill("SIGKILL");
      }, options.terminationGraceMs);
      hardTimer = setTimeout(() => {
        if (settled) return;
        forcedTermination = true;
        child.kill("SIGKILL");
      }, options.terminationGraceMs + HARD_SETTLEMENT_SLACK_MS);
    }, options.timeoutMs);
  });
}

export class FixedHermesSkillsCli implements HermesSkillsCli {
  private readonly executablePath: string | null;

  constructor(
    executable = process.env.CABINET_HERMES_CLI_PATH?.trim() || null,
    private readonly defaultTimeoutMs = DEFAULT_TIMEOUT_MS,
    private readonly terminationGraceMs = DEFAULT_TERMINATION_GRACE_MS,
  ) {
    this.executablePath = executable;
  }

  configured(): boolean {
    return Boolean(this.executablePath);
  }

  async inspect(): Promise<HermesCliAuthority> {
    const configured = this.executablePath;
    if (!configured) throw new HermesSkillsAdapterError("unavailable", "An approved Hermes CLI executable is not configured.");
    if (!path.isAbsolute(configured)) throw new HermesSkillsAdapterError("contract_mismatch", "The approved Hermes CLI executable must be an absolute path.");

    let resolved: string;
    let executableStat;
    let executableBytes: Buffer;
    try {
      resolved = await realpath(configured);
      executableStat = await stat(resolved, { bigint: true });
      await access(resolved, constants.X_OK);
      if (!executableStat.isFile() || executableStat.size > BigInt(MAX_EXECUTABLE_BYTES)) throw new Error("unexpected executable target");
      executableBytes = await readFile(resolved);
    } catch {
      throw new HermesSkillsAdapterError("contract_mismatch", "The approved Hermes CLI executable is missing, non-executable, or unexpected.");
    }

    const versionResult = await runBoundedProcess(resolved, ["--version"], {
      timeoutMs: Math.min(this.defaultTimeoutMs, 15_000),
      terminationGraceMs: this.terminationGraceMs,
    });
    if (versionResult.timedOut || versionResult.exitCode !== 0) {
      throw new HermesSkillsAdapterError("contract_mismatch", "The approved Hermes CLI did not report its audited identity.");
    }
    const lines = stripAnsi(versionResult.output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const versionLine = lines.find((line) => line.startsWith("Hermes Agent v"));
    const installLine = lines.find((line) => line.startsWith("Install directory: "));
    if (!versionLine || !/^Hermes Agent v0\.19\.0 \(\d{4}\.\d{1,2}\.\d{1,2}\) · upstream [0-9a-f]{8,40}$/.test(versionLine) || !installLine) {
      throw new HermesSkillsAdapterError("contract_mismatch", "The approved Hermes CLI is not the audited Hermes Agent 0.19.0 executable.");
    }
    const installDirectory = installLine.slice("Install directory: ".length).trim();
    if (!path.isAbsolute(installDirectory)) throw new HermesSkillsAdapterError("contract_mismatch", "The Hermes CLI reported an unexpected installation identity.");
    let expectedExecutable: string;
    try {
      expectedExecutable = await realpath(path.join(installDirectory, "venv", "bin", "hermes"));
    } catch {
      throw new HermesSkillsAdapterError("contract_mismatch", "The Hermes CLI reported an unexpected installation identity.");
    }
    if (expectedExecutable !== resolved) throw new HermesSkillsAdapterError("contract_mismatch", "The Hermes CLI target does not match its audited installation identity.");

    return {
      version: AUDITED_HERMES_VERSION,
      opaqueIdentity: hash(JSON.stringify({
        resolved,
        device: executableStat.dev.toString(),
        inode: executableStat.ino.toString(),
        size: executableStat.size.toString(),
        modifiedNanoseconds: executableStat.mtimeNs.toString(),
        sha256: hash(executableBytes),
        versionLine,
      })),
    };
  }

  async run(args: readonly string[], options: { input?: string; timeoutMs?: number; expectedAuthority?: string } = {}): Promise<CliResult> {
    const authority = await this.inspect();
    if (!options.expectedAuthority || authority.opaqueIdentity !== options.expectedAuthority) {
      throw new HermesSkillsAdapterError("contract_mismatch", "The audited Hermes CLI identity changed before dispatch.");
    }
    const executable = await realpath(this.executablePath as string);
    return runBoundedProcess(executable, args, {
      input: options.input,
      timeoutMs: options.timeoutMs ?? this.defaultTimeoutMs,
      terminationGraceMs: this.terminationGraceMs,
    });
  }
}

export class HermesSkillsAgentAdapter implements HermesSkillsAdapter {
  constructor(
    private readonly config: HermesReadOnlyServerConfig,
    private readonly fetchImpl: Fetch = fetch,
    private readonly cli: HermesSkillsCli = new FixedHermesSkillsCli(),
  ) {}

  private profile(): string {
    const profile = safeName(this.config.profile);
    if (!profile) throw new HermesSkillsAdapterError("unavailable", "A safe Hermes profile is not configured.");
    return profile;
  }

  private async api(pathname: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.config.apiBaseUrl || !this.config.apiKey || this.config.sourceStates.agent_api !== "ready_to_probe") {
      throw new HermesSkillsAdapterError("unavailable", "Hermes Agent API management is not configured.");
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.config.apiBaseUrl}${pathname}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
        cache: "no-store",
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) throw new HermesSkillsAdapterError("authentication", "Hermes rejected the configured server credential.");
      if (!response.ok) throw new HermesSkillsAdapterError("invalid_response", `Hermes management returned HTTP ${response.status}.`, init.method !== undefined && init.method !== "GET", true);
      return await response.json();
    } catch (error) {
      if (error instanceof HermesSkillsAdapterError) throw error;
      const timedOut = error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
      throw new HermesSkillsAdapterError(timedOut ? "timeout" : "unavailable", timedOut ? "Hermes management timed out." : "Hermes management is unreachable.", init.method !== undefined && init.method !== "GET", false);
    } finally {
      clearTimeout(timer);
    }
  }

  private async assertAgentContract(): Promise<string> {
    const openApi = record(await this.api("/openapi.json"));
    if (record(openApi.info).version !== AUDITED_HERMES_VERSION) {
      throw new HermesSkillsAdapterError("contract_mismatch", "Hermes Agent API does not report the audited 0.19.0 contract.");
    }
    return AUDITED_HERMES_VERSION;
  }

  async authorize(action: HermesSkillAction): Promise<string> {
    const agentVersion = await this.assertAgentContract();
    if (action === "update") throw new HermesSkillsAdapterError("contract_mismatch", "Target-specific update verification remains audit-only for Hermes Agent 0.19.0.");
    if (action === "enable" || action === "disable") {
      return hash(JSON.stringify({ contract: "agent-api-toggle", agentVersion, profile: this.profile() }));
    }
    const cliAuthority = await this.cli.inspect();
    return hash(JSON.stringify({ contract: `skills-${action}`, agentVersion, cliAuthority: cliAuthority.opaqueIdentity, profile: this.profile() }));
  }

  async read(query = ""): Promise<HermesSkillsSnapshot> {
    const profile = this.profile();
    const observedAt = new Date().toISOString();
    const normalizedQuery = safeLabel(query, 80) ?? "";
    const profileParam = encodeURIComponent(profile);
    const cliConfigured = this.cli.configured();
    try {
      const [openApiRaw, installedRaw, sourcesRaw, catalogRaw] = await Promise.all([
        this.api("/openapi.json"),
        this.api(`/api/skills?profile=${profileParam}`),
        this.api(`/api/skills/hub/sources?profile=${profileParam}`),
        normalizedQuery
          ? this.api(`/api/skills/hub/search?q=${encodeURIComponent(normalizedQuery)}&source=all&limit=50&profile=${profileParam}`)
          : Promise.resolve(null),
      ]);
      if (record(record(openApiRaw).info).version !== AUDITED_HERMES_VERSION) throw new HermesSkillsAdapterError("contract_mismatch", "Hermes Agent API does not report the audited 0.19.0 contract.");
      if (!Array.isArray(installedRaw) || !sourcesRaw || typeof sourcesRaw !== "object" || Array.isArray(sourcesRaw)) {
        throw new HermesSkillsAdapterError("invalid_response", "Hermes returned malformed canonical Skills state.");
      }
      if (normalizedQuery && (!catalogRaw || typeof catalogRaw !== "object" || Array.isArray(catalogRaw))) {
        throw new HermesSkillsAdapterError("invalid_response", "Hermes returned malformed catalog state.");
      }

      const sources = record(sourcesRaw);
      const installedByIdentifier = record(sources.installed);
      const hubIdentifiersByName = new Map<string, string[]>();
      for (const [identifierValue, detailValue] of Object.entries(installedByIdentifier)) {
        const identifier = safeIdentifier(identifierValue);
        const name = safeName(record(detailValue).name);
        if (!identifier || !name) continue;
        const existing = hubIdentifiersByName.get(name) ?? [];
        existing.push(identifier);
        hubIdentifiersByName.set(name, existing);
      }

      const ambiguousIdentities: string[] = [];
      const installed = installedRaw.flatMap((raw): HermesManagedSkill[] => {
        const item = record(raw);
        const name = safeName(item.name);
        if (!name) return [];
        const provenance = item.provenance === "hub" || item.provenance === "bundled" || item.provenance === "agent" ? item.provenance : null;
        const hubIdentifiers = provenance === "hub" ? [...new Set(hubIdentifiersByName.get(name) ?? [])] : [];
        const hubIdentifier = hubIdentifiers.length === 1 ? hubIdentifiers[0] : null;
        const identity = installedIdentity(profile, name, provenance, hubIdentifier);
        const skill: HermesManagedSkill = {
          identity,
          name,
          category: safeLabel(item.category),
          installed: true,
          enabled: typeof item.enabled === "boolean" ? item.enabled : null,
          version: safeLabel(item.version, 32),
          source: provenance === "hub" ? safeLabel(item.source) ?? (hubIdentifier?.split("/")[0] ?? "Hermes Skills Hub") : provenance,
          provenance,
          hubIdentifier,
          profile,
          updateAvailable: null,
          observedAt,
          supportedActions: [],
        };
        skill.supportedActions = supportedActions(skill, cliConfigured);
        if (provenance === "hub" && hubIdentifiers.length !== 1) {
          ambiguousIdentities.push(identity);
          skill.supportedActions = [];
        }
        return [skill];
      });

      const installedHubIdentifiers = new Set([...hubIdentifiersByName.values()].flat());
      const rawAvailable = normalizedQuery ? array(record(catalogRaw).results) : array(sources.featured);
      const available = rawAvailable.flatMap((raw): HermesManagedSkill[] => {
        const item = record(raw);
        const name = safeName(item.name);
        const identifier = safeIdentifier(item.identifier);
        if (!name || !identifier || installedHubIdentifiers.has(identifier)) return [];
        const skill: HermesManagedSkill = {
          identity: identifier,
          name,
          category: null,
          installed: false,
          enabled: null,
          version: null,
          source: safeLabel(item.source) ?? identifier.split("/")[0] ?? "Hermes Skills Hub",
          provenance: "hub",
          hubIdentifier: identifier,
          profile,
          updateAvailable: null,
          observedAt,
          supportedActions: cliConfigured ? ["install"] : [],
        };
        return [skill];
      });
      const installedUnique = uniqueSkills(installed);
      const availableUnique = uniqueSkills(available);
      const total = installedUnique.items.length + availableUnique.items.length;
      return {
        fixture: false,
        fixtureLabel: null,
        profile,
        observedAt,
        sourceState: total ? "success" : "connected_empty",
        summary: total ? `Hermes reported ${installedUnique.items.length} installed skill(s) and ${availableUnique.items.length} catalog result(s).` : "Hermes responded with an empty skills catalog.",
        interface: "Hermes Agent 0.19.0 authenticated API",
        operations: {
          install: { supported: cliConfigured, interface: cliConfigured ? "audited absolute Hermes CLI: skills install <identifier> --yes" : "Unavailable", note: cliConfigured ? "Requires an exact 0.19.0 executable identity before prepare and commit." : "Configure CABINET_HERMES_CLI_PATH server-side to authorize this operation." },
          enable: { supported: true, interface: "PUT /api/skills/toggle", note: "Profile-scoped Hermes activation state." },
          disable: { supported: true, interface: "PUT /api/skills/toggle", note: "Profile-scoped Hermes activation state." },
          update: { supported: false, interface: "Audit only", note: "Hermes Agent 0.19.0 does not provide exact structured target-specific update readback." },
          remove: { supported: cliConfigured, interface: cliConfigured ? "audited absolute Hermes CLI: skills uninstall <name>" : "Unavailable", note: cliConfigured ? "Requires exact hub identity and exact 0.19.0 executable identity." : "Configure CABINET_HERMES_CLI_PATH server-side to authorize this operation." },
        },
        installed: installedUnique.items,
        available: availableUnique.items,
        duplicateIdentities: [...new Set([...installedUnique.duplicates, ...availableUnique.duplicates, ...ambiguousIdentities])],
      };
    } catch (error) {
      const kind = error instanceof HermesSkillsAdapterError ? error.kind : "unavailable";
      const state: HermesSkillsSourceState = kind === "authentication" ? "authentication_failure" : kind === "timeout" ? "timeout" : kind === "invalid_response" || kind === "contract_mismatch" ? "malformed" : "unavailable";
      return {
        fixture: false,
        fixtureLabel: null,
        profile,
        observedAt,
        sourceState: state,
        summary: error instanceof Error ? sanitizeHermesText(error.message, 160) : "Hermes skills management is unavailable.",
        interface: "Hermes Agent 0.19.0 authenticated API",
        operations: Object.fromEntries((["install", "enable", "disable", "update", "remove"] as HermesSkillAction[]).map((action) => [action, { supported: false, interface: "Unavailable", note: "The canonical Hermes source is unavailable." }])) as HermesSkillsSnapshot["operations"],
        installed: [],
        available: [],
        duplicateIdentities: [],
      };
    }
  }

  async execute(operation: HermesSkillOperation, expectedAuthority: string): Promise<{ responseReceived: boolean }> {
    if (operation.profile !== this.profile() || !safeName(operation.targetName)) {
      throw new HermesSkillsAdapterError("dispatch_failed", "The Hermes skill target is invalid.");
    }
    const currentAuthority = await this.authorize(operation.action);
    if (currentAuthority !== expectedAuthority) throw new HermesSkillsAdapterError("contract_mismatch", "The audited Hermes execution authority changed before dispatch.");
    if (operation.action === "enable" || operation.action === "disable") {
      await this.api(`/api/skills/toggle?profile=${encodeURIComponent(operation.profile)}`, {
        method: "PUT",
        body: JSON.stringify({ name: operation.targetName, enabled: operation.action === "enable", profile: operation.profile }),
      });
      return { responseReceived: true };
    }
    if (operation.action === "update") throw new HermesSkillsAdapterError("contract_mismatch", "Target-specific update remains audit-only.");

    const cliAuthority = await this.cli.inspect();
    const args = ["-p", operation.profile, "skills"];
    if (operation.action === "install") {
      const identifier = safeIdentifier(operation.targetIdentity);
      if (!identifier) throw new HermesSkillsAdapterError("dispatch_failed", "The Hermes catalog identity is invalid.");
      args.push("install", identifier, "--yes");
    } else if (operation.action === "remove") {
      if (!safeIdentifier(operation.targetIdentity.split(":hub:")[1] ?? "")) throw new HermesSkillsAdapterError("dispatch_failed", "The exact Hermes hub identity is unavailable.");
      args.push("uninstall", operation.targetName);
    } else {
      throw new HermesSkillsAdapterError("dispatch_failed", "This Hermes skill operation is unsupported.");
    }
    const actionAuthority = hash(JSON.stringify({ contract: `skills-${operation.action}`, agentVersion: AUDITED_HERMES_VERSION, cliAuthority: cliAuthority.opaqueIdentity, profile: this.profile() }));
    if (actionAuthority !== expectedAuthority) throw new HermesSkillsAdapterError("contract_mismatch", "The audited Hermes CLI identity changed before dispatch.");
    const result = await this.cli.run(args, {
      input: operation.action === "remove" ? "yes\n" : undefined,
      expectedAuthority: cliAuthority.opaqueIdentity,
    });
    if (result.timedOut || result.forcedTermination) throw new HermesSkillsAdapterError("timeout", "Hermes did not report a final operation result before timeout.", true, false);
    if (result.exitCode !== 0) throw new HermesSkillsAdapterError("invalid_response", "Hermes reported a non-successful operation result.", true, true);
    return { responseReceived: true };
  }
}
