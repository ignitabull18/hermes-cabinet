export const SAFE_FIELDS = Object.freeze([
  "profile",
  "provider",
  "model",
  "modelSource",
  "credentialState",
  "endpointClass",
  "fallbackModels",
  "configSource",
  "ready",
  "blockedReason",
]);

export function normalizeOptionalOverride(value) {
  if (value === undefined) return { supplied: false, value: undefined };
  if (value === null) return { supplied: true, value: undefined };
  if (typeof value !== "string") {
    throw new TypeError("model override must be a string when supplied");
  }
  const normalized = value.trim();
  return { supplied: true, value: normalized || undefined };
}

export function buildSessionNewParameters({ cwd, model, provider }) {
  const modelOverride = normalizeOptionalOverride(model);
  const providerOverride = normalizeOptionalOverride(provider);
  const parameters = { cwd, mcpServers: [] };
  if (modelOverride.value !== undefined) parameters.model = modelOverride.value;
  if (providerOverride.value !== undefined) parameters.provider = providerOverride.value;
  return parameters;
}

export function validateReadiness(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("readiness result must be an object");
  }
  for (const field of SAFE_FIELDS) {
    if (!(field in value)) throw new TypeError(`missing safe readiness field: ${field}`);
  }
  for (const field of Object.keys(value)) {
    if (!SAFE_FIELDS.includes(field)) {
      throw new TypeError(`unexpected readiness field: ${field}`);
    }
  }
  if (typeof value.profile !== "string" || !value.profile.trim()) {
    throw new TypeError("profile must be nonempty");
  }
  if (value.ready && (!value.provider || !value.model)) {
    throw new TypeError("ready requires nonempty provider and model");
  }
  return value;
}

export function classifyObservedProviderFailure({ status, model, message, configuredRetries }) {
  const normalizedMessage = String(message ?? "").toLowerCase();
  const modelMissing = typeof model !== "string" || !model.trim();
  const quotedEmptyModel404 =
    status === 404 &&
    modelMissing &&
    normalizedMessage.includes("model") &&
    normalizedMessage.includes("not found");
  return {
    emptyModelOwner: modelMissing ? "hermes_acp_session_factory" : null,
    httpStatusOwner: status === 404 ? "provider_endpoint" : null,
    retryOwner: quotedEmptyModel404 ? "hermes_conversation_loop" : null,
    configuredAttempts: configuredRetries,
    classifierGap:
      quotedEmptyModel404
        ? "quoted_empty_model_does_not_match_unquoted_model_not_found_pattern"
        : null,
  };
}
