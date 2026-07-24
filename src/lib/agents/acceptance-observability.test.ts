import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  acceptanceObservabilityEnabled,
  clearAcceptanceRuntimeObservation,
  readAcceptanceRuntimeObservation,
  recordAcceptanceRuntimeObservation,
  recordAcceptanceResponseExactness,
} from "./acceptance-observability";

function withAcceptanceEnvironment(run: () => void): void {
  const previous = {
    enabled: process.env.CABINET_ACCEPTANCE_OBSERVABILITY,
    isolated: process.env.CABINET_ACCEPTANCE_ISOLATED,
    mode: process.env.CABINET_RUNTIME_MODE,
    expected: process.env.CABINET_ACCEPTANCE_EXPECTED_RESPONSE_SHA256,
  };
  process.env.CABINET_ACCEPTANCE_OBSERVABILITY = "1";
  process.env.CABINET_ACCEPTANCE_ISOLATED = "1";
    process.env.CABINET_RUNTIME_MODE = "hermes";
  process.env.CABINET_ACCEPTANCE_EXPECTED_RESPONSE_SHA256 = createHash("sha256")
    .update("expected")
    .digest("hex");
  try {
    run();
  } finally {
    if (previous.enabled === undefined) delete process.env.CABINET_ACCEPTANCE_OBSERVABILITY;
    else process.env.CABINET_ACCEPTANCE_OBSERVABILITY = previous.enabled;
    if (previous.isolated === undefined) delete process.env.CABINET_ACCEPTANCE_ISOLATED;
    else process.env.CABINET_ACCEPTANCE_ISOLATED = previous.isolated;
    if (previous.mode === undefined) delete process.env.CABINET_RUNTIME_MODE;
    else process.env.CABINET_RUNTIME_MODE = previous.mode;
    if (previous.expected === undefined) delete process.env.CABINET_ACCEPTANCE_EXPECTED_RESPONSE_SHA256;
    else process.env.CABINET_ACCEPTANCE_EXPECTED_RESPONSE_SHA256 = previous.expected;
  }
}

test("acceptance observability is disabled unless every process-side gate is exact", () => {
  const previous = process.env.CABINET_ACCEPTANCE_OBSERVABILITY;
  delete process.env.CABINET_ACCEPTANCE_OBSERVABILITY;
  try {
    assert.equal(acceptanceObservabilityEnabled(), false);
    recordAcceptanceRuntimeObservation("disabled", {
      provider: "provider",
      model: "model",
    });
    assert.equal(readAcceptanceRuntimeObservation("disabled"), null);
  } finally {
    if (previous === undefined) delete process.env.CABINET_ACCEPTANCE_OBSERVABILITY;
    else process.env.CABINET_ACCEPTANCE_OBSERVABILITY = previous;
  }
});

test("acceptance observations retain only bounded identities and nonnegative counters", () => {
  withAcceptanceEnvironment(() => {
    const id = "bounded";
    recordAcceptanceRuntimeObservation(id, {
      readinessState: "ready",
      provider: "ollama-cloud",
      model: "glm-5.2",
      modelRequestsAttempted: 2,
      providerRetries: 0,
      fallbackAttempts: 0,
      lastProviderHttpStatus: "2xx",
      lastFailureClass: "none",
      acpChildState: "running",
    });

    recordAcceptanceResponseExactness(id, "initial", {
      acpNormalized: "expected",
    });
    recordAcceptanceResponseExactness(id, "followUp", {
      rawModelFinal: "not-expected",
      acpNormalized: "expected",
    });
    assert.deepEqual(readAcceptanceRuntimeObservation(id)?.responseExactness, {
      initial: {
        rawModelFinalExact: null,
        acpNormalizedExact: true,
      },
      followUp: {
        rawModelFinalExact: false,
        acpNormalizedExact: true,
      },
    });
    assert.deepEqual(readAcceptanceRuntimeObservation(id), {
      readinessState: "ready",
      provider: "ollama-cloud",
      model: "glm-5.2",
      modelRequestsAttempted: 2,
      providerRetries: 0,
      fallbackAttempts: 0,
      lastProviderHttpStatus: "2xx",
      lastFailureClass: "none",
      acpChildState: "running",
      responseExactness: {
        initial: {
          rawModelFinalExact: null,
          acpNormalizedExact: true,
        },
        followUp: {
          rawModelFinalExact: false,
          acpNormalizedExact: true,
        },
      },
    });

    recordAcceptanceRuntimeObservation(id, {
      provider: "https://credential@example.invalid/private",
      model: "",
      providerRetries: -1,
    });
    const sanitized = readAcceptanceRuntimeObservation(id);
    assert.equal(sanitized?.provider, null);
    assert.equal(sanitized?.model, null);
    assert.equal(sanitized?.providerRetries, 0);
    clearAcceptanceRuntimeObservation(id);
  });
});
