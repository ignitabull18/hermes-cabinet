import { AUDITED_HERMES_REVISION } from "./governance.js";

export function fixtureSnapshot(overrides = {}) {
  return {
    schema: "hermes.models-providers.snapshot/v1",
    hermesRevision: AUDITED_HERMES_REVISION,
    profile: "fixture-profile",
    modelCatalog: {
      source: "fixture:/api/model/options",
      providers: [
        {
          id: "provider-a",
          models: ["model-a", "model-a-large"],
          catalogKind: "curated_fixture",
        },
        {
          id: "provider-b",
          models: ["model-b"],
          catalogKind: "curated_fixture",
        },
      ],
    },
    configuredDefault: {
      source: "fixture:profile-config",
      provider: "provider-a",
      model: "model-a",
    },
    effectiveRuntime: {
      source: "fixture:session-readback",
      state: "known",
      provider: "provider-a",
      model: "model-a",
      sessionId: "fixture-session",
    },
    providerAccounts: [
      {
        id: "provider-a",
        state: "ready",
        authKind: "api_key",
        authFlow: null,
        disconnectable: true,
      },
      {
        id: "provider-b",
        state: "ready",
        authKind: "oauth",
        authFlow: "device_code",
        disconnectable: true,
      },
      {
        id: "external",
        state: "ready",
        authKind: "external",
        authFlow: "external",
        disconnectable: false,
      },
    ],
    profileOverride: {
      source: "fixture:profile-config",
      profile: "fixture-profile",
      provider: "provider-a",
      model: "model-a",
    },
    historicalAudit: {
      sourceRevision: AUDITED_HERMES_REVISION,
      recordedAt: "2026-07-23T00:00:00.000Z",
      evidence: ["installed-source-fixture"],
    },
    ...overrides,
  };
}
