# Hermes models/providers management audit

## Outcome

Status: **passed as a research/prototype stream; not a merge-ready live
integration**.

The exact installed Hermes checkout was verified at
`55759cb2737cd3870f9de4693f66fa38eaf0dd2b` (2026-07-22). The audit used that
checkout's source, tests, and bundled official documentation. It did not call a
Hermes API, start Desktop Management, load a profile, inspect any credential or
secret value, or mutate model/provider state.

Hermes already has most low-level read/write mechanics, but it does not expose a
single Cabinet-suitable governed contract. The central correctness constraint is
that these are separate state planes:

1. **Model catalog** — advertised/curated choices, potentially enriched from
   caches and networks.
2. **Configured default** — `model.provider` + `model.default` in one profile.
3. **Effective runtime** — the provider/model actually used by a particular
   running session or turn.
4. **Provider account state** — credential availability and health, without
   credential content.
5. **Profile override** — a named profile's own configured default. This is a
   profile-scoped configuration, not proof of a live session override.
6. **Historical audit** — source revision, prior preview/receipt, and canonical
   readback evidence.

Cabinet must never collapse these into one “current model” field.

## Exact installed contracts

All source references below are relative to the installed Hermes repository at
the audited revision.

| Concern | Exact Hermes contract | What it proves | What it does not prove |
|---|---|---|---|
| Advertised models | `GET /api/model/options?profile=&refresh=&include_unconfigured=&explicit_only=`; implemented by `hermes_cli/inventory.py::build_models_payload` | Provider rows, curated models, current configured provider/model, auth hints, pricing/capability enrichment | Stable catalog version, immutable membership, effective session model, or a pure offline read. Refresh and enrichment can call provider/catalog services. |
| Configured default + context | `GET /api/model/info?profile=` | Profile config model/provider plus auto/config/effective context-length calculation and model capabilities | The model/provider of a running session. “Effective context length” here means metadata resolution for configured model, not effective runtime identity. |
| Configured model write | `POST /api/model/set` with `{scope, provider, model, task?, profile?, base_url?, api_key?, confirm_expensive_model?}` | Writes main or auxiliary profile configuration | Existing live session change. Official docs and route comments say it applies to new sessions only. No stale fingerprint, idempotency key, exact diff, typed confirmation, or receipt. |
| Named profile model | `PUT /api/profiles/{name}/model` with `{provider, model}` | Writes the named profile's `model.provider` and `model.default` | Current process retargeting or running-session effect. |
| Effective Gateway model | Gateway precedence and session state in `gateway/run.py` and `gateway/slash_commands.py`; session `/model` overrides are persisted and rehydrated | Per-session overrides can outrank profile config; runtime model is synchronized into session metadata | A global enumeration/readback contract that joins provider, model, override provenance, and turn identity for Cabinet. |
| OAuth/account list | `GET /api/providers/oauth?profile=` | Account-card membership and provider-specific status | A strictly redacted, side-effect-free provider-account inventory. Current payload design includes token previews and source labels; some status resolvers may refresh or reconcile credentials. Cabinet must not proxy those fields. |
| OAuth initiation | `POST /api/providers/oauth/{provider}/start?profile=`; `POST .../submit`; `GET .../poll/{session}`; `DELETE /api/providers/oauth/sessions/{session}` | Hermes-managed PKCE/device-code flows for catalogued providers | A durable Cabinet authority, external-CLI OAuth, idempotent initiation, stale-state binding, or completion readback tied to a governance receipt. Start/submit/cancel are token-protected. |
| Provider revoke | `DELETE /api/providers/oauth/{provider}?profile=` | Clears Hermes-managed OAuth state for supported providers | Safe automatic removal for externally owned credentials. Source explicitly refuses external providers. It has no target fingerprint, typed confirmation, or unknown-outcome receipt. |
| API-key providers | `hermes auth add <provider> --type api-key`, credential-pool commands, and generic dashboard key/env lifecycle | Hermes supports API-key-backed providers and pooled credentials | A safe Cabinet API accepting secrets. This stream intentionally did not inspect or prototype secret ingestion. Secret write/reveal should remain a separate high-risk contract. |
| Provider aliases | `ProviderProfile.aliases`, provider normalization, and direct model aliases from `model_aliases` / `model.aliases` | Alias resolution is supported by installed code | A first-class read API that exposes canonical target, alias provenance, collisions, and shadowing. User aliases can shadow built-ins. |
| Fallback models | `hermes fallback`; canonical `fallback_providers` list plus legacy `fallback_model`; `get_fallback_chain()` | Ordered cross-provider fallback is supported and legacy state remains readable | A dedicated dashboard/Cabinet REST read/write contract with governed preview, validation, or canonical receipt. |
| Context limits | `/api/model/info` returns auto/config/effective context fields and capabilities; provider profiles can define output caps | Configured override and metadata-derived limits | A guarantee that a currently running process uses that same limit after configuration changes. |
| Update safety | Profile-scoped `load_config`/`save_config`, compatibility reads, provider plugin registry, catalog cache | Hermes preserves several legacy/current config shapes | A versioned management schema or compare-and-swap mutation contract across Hermes upgrades. |

## Catalog, configured, and effective state

`build_models_payload()` returns `providers`, `model`, and `provider`, but its
`model` and `provider` values come from the profile config snapshot. The naming
is therefore configuration-oriented. Cabinet should label these fields
`configuredDefault`, not `currentEffective`.

The installed official guide says dashboard model changes take effect for the
next new Gateway session or next new dashboard PTY. Existing sessions retain
their model and can use `/model` for a session-only hot swap. Gateway code also
rehydrates persisted session model overrides after restart. Consequently,
canonical effective readback must be session-scoped and include:

- session/turn identifier;
- effective provider and model;
- source (`profile_default`, `channel_override`, `session_override`,
  `one_turn_override`, `fallback`);
- observation time;
- whether execution has actually occurred since a change.

If Hermes cannot supply all of that, Cabinet must show effective state as
`unknown`, never copy the configured default into it.

## Provider/account state

Provider catalog membership, authentication presence, credential verification,
entitlement, exhaustion, and active routing are different facts. A suitable
redacted account record is:

```json
{
  "provider": "canonical-provider-id",
  "auth_kind": "api_key | oauth | external | aws_sdk",
  "state": "absent | configured | ready | exhausted | invalid | unknown",
  "source_class": "hermes_store | environment | external_cli | sdk_chain",
  "verified_at": null,
  "disconnectable": false
}
```

It must never contain a token preview, source path, key label derived from a
secret, or raw provider error. “Configured” must not be rendered as “ready.”

## Governed preview prototype

The isolated package under
`experiments/management/models-providers/` implements fixture-only previews for:

- select model;
- change provider;
- apply profile override;
- initiate OAuth;
- revoke provider.

Every preview binds the audited Hermes revision, profile, entire six-plane
snapshot, action, and exact target into SHA-256 fingerprints. Commit requires
the exact typed phrase and a fresh canonical reread. A changed snapshot blocks
before dispatch. The coordinator permits one dispatch and zero automatic
retries. Any exception after the dispatch boundary becomes `outcome_unknown`
and requires canonical readback before any further attempt. A verified receipt
is issued only after injected canonical readback confirms the target. Reusing a
preview returns the same receipt and never dispatches again.

The prototype has no HTTP client, filesystem writer, environment loader,
process spawn, secret field, or live endpoint. It cannot mutate Hermes.

## Action-specific governance

| Action | Prepare requirements | Dispatch boundary | Canonical readback |
|---|---|---|---|
| Select model | Exact profile, catalog membership, configured/effective separation, context/capability warnings | One profile-default mutation | Profile config changed; running sessions remain separately observed |
| Change provider | Select-model requirements plus redacted provider account `ready` | One atomic provider+model mutation; do not separately write provider then model | Profile config pair, account still ready, no claim about existing sessions |
| Apply profile override | Named profile identity and fingerprint | One named-profile mutation | Reread that exact profile, not dashboard process profile |
| Initiate OAuth | Provider supports Hermes-managed PKCE/device code; profile bound; no external flow | One start request | Pending session identity/status; configured model unchanged |
| Revoke provider | Exact provider account, Hermes-owned/disconnectable state, explicit impact preview if configured | One revoke request | Account absent; separately reread configured default because Hermes logout/revoke paths can differ |

OAuth completion is intentionally not treated as part of initiation. It is a
separate operator/browser interaction followed by status readback. API-key entry
is also excluded because accepting a secret requires a separate write-only,
server-side design and threat review.

## Historical source audit

- The audited installed head is `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`.
- Git history attributes dashboard OAuth provider management to
  `247929b0dd` (2026-04-13).
- Git history attributes dashboard main/auxiliary model configuration,
  including `/api/model/options` and `/api/model/set`, to `3c27efbb91`
  (2026-04-29).
- Subsequent history contains repeated fixes for model normalization, provider
  routing, endpoint credential clearing, session-only model switching, catalog
  filtering, and provider configuration preservation. This is strong evidence
  that Cabinet should bind to a versioned upstream contract rather than
  reproduce internal config logic.

This is source-history evidence only. No historical configuration, auth store,
or operator activity was inspected.

## Gaps and upstream recommendations

1. Add a versioned, machine-readable `models-providers.snapshot/v1` endpoint
   that returns the six planes separately and is redacted by construction.
2. Add a session-scoped effective-runtime endpoint with override/fallback
   provenance. Do not label profile configuration as effective state.
3. Add prepare/commit/readback operations with server-issued target
   fingerprints, compare-and-swap revision, idempotency key/receipt, one
   dispatch, and explicit `outcome_unknown`.
4. Make catalog provenance explicit per model: curated, cached-live,
   provider-live, user-configured, or fallback. Include stable canonical IDs and
   alias provenance/collisions.
5. Provide a pure provider-account status mode that never refreshes credentials
   and returns no token preview, filesystem path, or secret-derived label.
6. Separate OAuth initiation, OAuth completion, credential revoke, and API-key
   write contracts. External credentials must remain non-disconnectable.
7. Add first-class versioned read/write contracts for model aliases, fallback
   chains, and context overrides. Preserve legacy config reads, but write only
   canonical shapes.
8. Return mutation impact explicitly: `new_sessions_only`,
   `existing_sessions_unchanged`, restart requirement, and affected profile.
9. Avoid binding Cabinet to Desktop Management's ephemeral credential. Expose a
   durable local management authority designed for an operator UI, or a
   governed CLI contract comparable to the Skills boundary.

## Recommendation

Do not merge a live adapter from this stream. First upstream a redacted,
versioned snapshot plus governed prepare/commit/readback contract. Cabinet can
then render catalog/config/account state immediately while leaving effective
runtime `unknown` unless Hermes supplies session-scoped evidence.

## Verification and safety

- Prototype tests: 8 passed, 0 failed.
- `git diff --check`: required before commit.
- No disposable server was needed; port 4223 was not used.
- Production Cabinet, canonical Cabinet data, `.cabinet.env`, Hermes services,
  profiles, models, providers, OAuth, credentials, launchd, and network mappings
  were untouched.
