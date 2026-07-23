import { createHash } from "node:crypto";

const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const RESERVED_PROFILES = new Set(["hermes", "root", "sudo", "test", "tmp"]);
const SECRET_KEY = /(api[_-]?key|auth|credential|password|secret|token)/i;
const ALLOWED_OPERATIONS = new Set([
  "profile.create",
  "profile.delete",
  "profile.rename",
  "profile.select",
  "settings.patch",
]);

export class GovernanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
  }
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  }
  return value;
}

function digest(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}

function assertProfileId(value, label = "profile") {
  const name = String(value ?? "").trim().toLowerCase();
  if (name === "default") return name;
  if (!PROFILE_ID.test(name) || RESERVED_PROFILES.has(name)) {
    throw new GovernanceError("invalid_profile", `${label} is not a valid Hermes profile id`);
  }
  return name;
}

function assertSecretFree(value, path = "value") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertSecretFree(child, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      throw new GovernanceError("secret_field", `${path}.${key} is outside this prototype`);
    }
    assertSecretFree(child, `${path}.${key}`);
  }
}

function normalizeProfiles(profiles) {
  const seen = new Set();
  const normalized = profiles.map((profile) => {
    const name = assertProfileId(profile.name);
    if (seen.has(name)) {
      throw new GovernanceError("duplicate_profile", `duplicate profile ${name}`);
    }
    seen.add(name);
    assertSecretFree(profile.settings ?? {}, `profiles.${name}.settings`);
    return {
      name,
      isDefault: name === "default",
      settings: stable(profile.settings ?? {}),
      service: {
        gatewayRunning: Boolean(profile.service?.gatewayRunning),
        restartRequired: Boolean(profile.service?.restartRequired),
      },
    };
  });
  if (!seen.has("default")) {
    throw new GovernanceError("missing_default", "Hermes default profile is required");
  }
  return normalized.sort((left, right) => left.name.localeCompare(right.name));
}

export function readState(raw) {
  if (!raw || typeof raw !== "object") {
    throw new GovernanceError("invalid_state", "state must be an object");
  }
  const profiles = normalizeProfiles(raw.profiles ?? []);
  const names = new Set(profiles.map(({ name }) => name));
  const sticky = assertProfileId(raw.active?.sticky ?? "default", "sticky profile");
  const current = assertProfileId(raw.active?.current ?? "default", "current profile");
  if (!names.has(sticky) || !names.has(current)) {
    throw new GovernanceError("unknown_active_profile", "active profile is absent from canonical profiles");
  }
  const canonical = {
    contractVersion: 1,
    source: "hermes-native-management",
    installedRevision: String(raw.installedRevision ?? ""),
    profiles,
    active: { sticky, current },
  };
  if (!/^[0-9a-f]{40}$/.test(canonical.installedRevision)) {
    throw new GovernanceError("invalid_revision", "installed Hermes revision must be a full commit SHA");
  }
  return { ...canonical, revision: digest(canonical) };
}

function findProfile(state, name) {
  const profile = state.profiles.find((candidate) => candidate.name === name);
  if (!profile) throw new GovernanceError("profile_not_found", `profile ${name} does not exist`);
  return profile;
}

function applyIntent(state, intent) {
  const operation = String(intent.operation ?? "");
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new GovernanceError("unsupported_operation", `unsupported operation ${operation}`);
  }
  const next = structuredClone(state);
  delete next.revision;

  if (operation === "settings.patch") {
    const target = assertProfileId(intent.target);
    const profile = findProfile(next, target);
    assertSecretFree(intent.patch ?? {}, "intent.patch");
    profile.settings = stable({ ...profile.settings, ...(intent.patch ?? {}) });
  } else if (operation === "profile.create") {
    const target = assertProfileId(intent.target);
    if (target === "default" || next.profiles.some(({ name }) => name === target)) {
      throw new GovernanceError("profile_exists", `profile ${target} already exists`);
    }
    assertSecretFree(intent.settings ?? {}, "intent.settings");
    next.profiles.push({
      name: target,
      isDefault: false,
      settings: stable(intent.settings ?? {}),
      service: { gatewayRunning: false, restartRequired: false },
    });
    next.profiles.sort((left, right) => left.name.localeCompare(right.name));
  } else if (operation === "profile.rename") {
    const target = assertProfileId(intent.target);
    const destination = assertProfileId(intent.destination, "destination profile");
    if (target === "default") {
      throw new GovernanceError("default_immutable", "default profile cannot be renamed");
    }
    if (next.profiles.some(({ name }) => name === destination)) {
      throw new GovernanceError("profile_exists", `profile ${destination} already exists`);
    }
    findProfile(next, target).name = destination;
    if (next.active.sticky === target) next.active.sticky = destination;
    if (next.active.current === target) next.active.current = destination;
    next.profiles.sort((left, right) => left.name.localeCompare(right.name));
  } else if (operation === "profile.select") {
    const target = assertProfileId(intent.target);
    findProfile(next, target);
    next.active.sticky = target;
  } else if (operation === "profile.delete") {
    const target = assertProfileId(intent.target);
    if (target === "default") {
      throw new GovernanceError("default_immutable", "default profile cannot be deleted");
    }
    findProfile(next, target);
    if (next.active.current === target) {
      throw new GovernanceError(
        "active_process_conflict",
        "the running process profile cannot be deleted through this prototype",
      );
    }
    next.profiles = next.profiles.filter(({ name }) => name !== target);
    if (next.active.sticky === target) next.active.sticky = "default";
  }

  return next;
}

function changedPaths(before, after, path = "") {
  if (JSON.stringify(stable(before)) === JSON.stringify(stable(after))) return [];
  if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    return before.flatMap((child, index) => {
      const label =
        child &&
        after[index] &&
        typeof child === "object" &&
        typeof after[index] === "object" &&
        child.name === after[index].name
          ? child.name
          : String(index);
      return changedPaths(child, after[index], `${path}/${label}`);
    });
  }
  if (
    !before ||
    !after ||
    typeof before !== "object" ||
    typeof after !== "object" ||
    Array.isArray(before) ||
    Array.isArray(after)
  ) {
    return [path || "/"];
  }
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .flatMap((key) => changedPaths(before[key], after[key], `${path}/${key}`));
}

export function prepareChange(state, intent) {
  if (intent.baseRevision !== state.revision) {
    throw new GovernanceError("stale_state", "prepare base revision does not match canonical state");
  }
  const expected = applyIntent(state, intent);
  const expectedState = readState(expected);
  if (expectedState.revision === state.revision) {
    throw new GovernanceError("no_change", "intent does not change canonical state");
  }
  const target = String(intent.target ?? "machine").trim().toLowerCase();
  const operation = String(intent.operation);
  const operationDigest = digest({
    baseRevision: state.revision,
    operation,
    target,
    expectedRevision: expectedState.revision,
  });
  const phrase = `APPLY HERMES ${operation.toUpperCase()} ${target} ${operationDigest.slice(0, 12)}`;
  return {
    contractVersion: 1,
    phase: "prepared",
    operation,
    target,
    baseRevision: state.revision,
    expectedRevision: expectedState.revision,
    dispatchKey: operationDigest,
    confirmationPhrase: phrase,
    diff: {
      changedPaths: changedPaths(state, expectedState).filter((path) => path !== "/revision"),
      beforeRevision: state.revision,
      afterRevision: expectedState.revision,
    },
    nativeDispatch: nativeDispatchFor(intent),
    restart: restartEnvelope(intent, state),
    expectedState,
    rollback: {
      automatic: false,
      requiresFreshPrepare: true,
      restoreRevision: state.revision,
      note: "Rollback is a new governed operation against a fresh canonical read.",
    },
  };
}

function nativeDispatchFor(intent) {
  const target = String(intent.target ?? "").trim().toLowerCase();
  switch (intent.operation) {
    case "settings.patch":
      return { method: "PUT", path: `/api/config?profile=${encodeURIComponent(target)}`, bodyKind: "config" };
    case "profile.create":
      return { method: "POST", path: "/api/profiles", bodyKind: "profile-create" };
    case "profile.rename":
      return { method: "PATCH", path: `/api/profiles/${encodeURIComponent(target)}`, bodyKind: "profile-rename" };
    case "profile.select":
      return { method: "POST", path: "/api/profiles/active", bodyKind: "profile-active" };
    case "profile.delete":
      return { method: "DELETE", path: `/api/profiles/${encodeURIComponent(target)}`, bodyKind: "none" };
    default:
      throw new GovernanceError("unsupported_operation", "unsupported operation");
  }
}

function restartEnvelope(intent, state) {
  const operation = intent.operation;
  const target = String(intent.target ?? "").trim().toLowerCase();
  const profile = state.profiles.find(({ name }) => name === target);
  if (operation === "profile.select") {
    return {
      required: true,
      scope: "future CLI and gateway invocations; Desktop primary backend relaunch",
      automatic: false,
    };
  }
  if (operation === "profile.rename" || operation === "profile.delete") {
    return {
      required: Boolean(profile?.service.gatewayRunning),
      scope: "target profile gateway/service and any profile-bound Desktop backend",
      automatic: false,
    };
  }
  if (operation === "settings.patch") {
    return {
      required: true,
      scope: "new agent session; gateway restart for gateway-consumed fields",
      automatic: false,
    };
  }
  return { required: false, scope: "none during create", automatic: false };
}

export class DispatchLedger {
  #receipts = new Map();

  async dispatch(prepared, confirmation, nativeDispatch, canonicalReread) {
    if (confirmation !== prepared.confirmationPhrase) {
      throw new GovernanceError("confirmation_mismatch", "typed confirmation does not match");
    }
    if (this.#receipts.has(prepared.dispatchKey)) {
      return this.#receipts.get(prepared.dispatchKey);
    }
    const started = {
      dispatchKey: prepared.dispatchKey,
      phase: "dispatched",
      attempts: 1,
      nativeOutcome: "outcome_unknown",
    };
    this.#receipts.set(prepared.dispatchKey, started);

    try {
      const response = await nativeDispatch(prepared.nativeDispatch);
      started.nativeOutcome = response?.ok === false ? "rejected" : "accepted";
    } catch {
      started.nativeOutcome = "outcome_unknown";
    }

    const reread = await canonicalReread();
    const canonical = readState(reread);
    const receipt = {
      ...started,
      phase:
        canonical.revision === prepared.expectedRevision
          ? "verified"
          : canonical.revision === prepared.baseRevision
            ? "not_applied"
            : "diverged",
      canonicalRevision: canonical.revision,
      retryAllowed: false,
    };
    this.#receipts.set(prepared.dispatchKey, receipt);
    return receipt;
  }
}
