import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSessionNewParameters,
  classifyObservedProviderFailure,
  normalizeOptionalOverride,
  validateReadiness,
} from "./differential.mjs";

test("unknown, null, and empty model overrides are omitted", () => {
  for (const model of [undefined, null, "", "   "]) {
    const parameters = buildSessionNewParameters({
      cwd: "/isolated/workspace",
      model,
      provider: undefined,
    });
    assert.deepEqual(parameters, {
      cwd: "/isolated/workspace",
      mcpServers: [],
    });
  }
});

test("non-string model overrides are rejected", () => {
  assert.throws(() => normalizeOptionalOverride(42), /must be a string/);
});

test("readiness cannot be ready with an empty provider or model", () => {
  const base = {
    profile: "operator-os",
    provider: "ollama-cloud",
    model: "glm-5.2",
    modelSource: "profile",
    credentialState: "present",
    endpointClass: "provider",
    fallbackModels: [],
    configSource: "explicit_hermes_home",
    ready: true,
    blockedReason: null,
  };
  assert.deepEqual(validateReadiness(base), base);
  assert.throws(() => validateReadiness({ ...base, model: "" }), /nonempty/);
  assert.throws(() => validateReadiness({ ...base, provider: "" }), /nonempty/);
});

test("quoted empty-model 404 is owned by Hermes retries after provider rejection", () => {
  assert.deepEqual(
    classifyObservedProviderFailure({
      status: 404,
      model: "",
      message: 'model "" not found',
      configuredRetries: 3,
    }),
    {
      emptyModelOwner: "hermes_acp_session_factory",
      httpStatusOwner: "provider_endpoint",
      retryOwner: "hermes_conversation_loop",
      configuredAttempts: 3,
      classifierGap:
        "quoted_empty_model_does_not_match_unquoted_model_not_found_pattern",
    },
  );
});
