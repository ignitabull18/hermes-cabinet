# Hermes Agent API read-only expansion — live acceptance

Classification: **Live runtime**. Captured: `2026-07-21T00:24:55.663Z`. Implementation revision: `103b5ed17179fede3a54ad61d19c48221c4def34`.

The isolated production build ran on `127.0.0.1:4011` with the existing Agent API configuration only. Hermes Management and Gateway remained independently unavailable. Interventions were disabled and the recorded Hermes mutation-call total was zero.

## Live sources reached

| Method and interface | Outcome | Projected result |
| --- | --- | --- |
| `GET /health/detailed` | Success | Running Agent version `0.19.0`; no active profile was reported by this source. |
| `GET /v1/capabilities` | Success | Installed server contract confirmed; arbitrary nested metadata was not returned to the browser. |
| `GET /api/sessions?limit=100&offset=0&include_children=true` | Success | 100 bounded session records returned; `has_more=true`. Raw identities, titles, previews, user identities, prompts, and messages were removed. |
| `GET /v1/models` | Success | One bounded server-advertised model identity returned. No provider-account or canonical model-settings claim was made. |

No legitimate known run identity was supplied, so `GET /v1/runs/{run_id}` was not called during live acceptance. Session detail, message history, and run-event SSE were not called. The installed SSE contract remains classified as a current known-run stream, not retrospective history.

## Truth and parity result

Session enumeration is deliberately a partial claim for the combined Chat and sessions capability: it is visible and degraded, but earns no Current Live Visibility or Live-Proven credit because transcripts were not requested. Models is the only newly full, fresh, source-specific capability and earns both credits. Model settings remains degraded because advertised model availability is not the canonical settings contract.

- Discoverability: 48/48, 100%
- Current Live Visibility: 1/48, 2%
- Governed Management: 3/48, 6%
- Live-Proven: 4/48, 8%
- Status summary: 20 Available, 1 Connected, 4 Degraded, 0 Disabled, 1 Unsupported, 22 Needs setup

<!-- GENERATED:HERMES_LIVE_PROVEN_ATTRIBUTION:START -->
### Live-Proven attribution

Generated directly from the canonical capability projection.

| Capability ID | Classification | Evidence origin | Proof kind | Proof scope | Source | Interface | Observed at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `command-center` | current | `raw_observation` | live | live_runtime_operation | Hermes detailed health bridge | /health/detailed | 2026-07-21T00:24:55.491Z |
| `models` | current | `raw_observation` | live | live_runtime_operation | Hermes Agent API advertised models | /v1/models | 2026-07-21T00:24:55.492Z |
| `approvals` | historical | `approved_evidence_catalog` | historical_audit | historical_live_acceptance | Cabinet Hermes M3-M7 acceptance suite | Hermes gateway and run decision contract | 2026-07-19T02:23:07Z |
| `browser-opencli` | historical | `approved_evidence_catalog` | historical_audit | historical_live_acceptance | OpenCLI read-only acceptance | opencli local page title, DOM read, and screenshot | 2026-07-19T20:18:51Z |
<!-- GENERATED:HERMES_LIVE_PROVEN_ATTRIBUTION:END -->

## Verification

- Full unit suite: 593 passed, 0 failed.
- Focused Agent API and management suite: 21 passed, 0 failed before exact-build capture; the post-correction Agent suite passed 8/8.
- Focused production-browser workflows: 9/9 passed after one transient harness daemon-health 502 was cleared by the clean rerun; the Agent-only readiness workflows passed on the first run.
- Focused ESLint: passed with no findings.
- Production build and its TypeScript gate: passed. Existing unrelated Turbopack broad NFT-trace warnings remain.
- Desktop `1440×900`: passed.
- Mobile `390×844`: passed with document width exactly 390 px and no horizontal overflow.
- Browser warning/error log: empty.
- Reduced-motion emulation: recognized; the Hermes surface introduced no continuous animation. Two pre-existing one-shot Cabinet shell entrance animations remain and are reported as an unrelated discrepancy.
- Machine, parity matrix, browser, and this report use the canonical projection. The machine evidence records the exact Live-Proven attribution.
- Credential, raw-content, and local-identity non-egress checks: passed.
- `.cabinet.env`: remained ignored and uncommitted.

## Evidence

- `live-runtime-projection.json`
- `configuration-readiness.json`
- `live-overview-1440x900.png`
- `live-sessions-lineage-1440x900.png`
- `live-overview-mobile-390x844.png`
- `live-sessions-mobile-390x844.png`

## Preserved discrepancies

- The Agent API returned 100 records with `has_more=true`; Cabinet intentionally does not claim complete session-history coverage from the bounded page.
- Many records have no end timestamp. Cabinet labels these `unended`; it does not infer that they are actively running.
- The configured profile is `operator-os`, but the live Agent health/session sources did not explicitly report an active profile. The observed profile therefore remains unknown.
- No durable global run enumeration, Agent artifact index, independent usage-history endpoint, or safe current-event history was found.
- Management and Gateway remain unavailable by design in this phase.
