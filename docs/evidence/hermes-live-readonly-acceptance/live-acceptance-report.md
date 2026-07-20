# Hermes Phase 4A partial live read-only acceptance closeout

- Classification: **Live runtime**
- Captured: `2026-07-20T23:51:43.030Z`
- Implementation revision: `9c887115128904c3ca7d6ae8ed5d4fb1a9789b55`
- Runtime Cabinet revision: `9c887115128904c3ca7d6ae8ed5d4fb1a9789b55`
- Running Hermes Agent version: `0.19.0`, confirmed by `GET /health/detailed`
- Running Hermes Agent commit: **Unknown**; the endpoint did not report it
- Detected local Agent checkout: `d7b36070ef80`, from local installation metadata
- Configured profile: `operator-os`
- Observed active profile: **Unknown — Management source unavailable**
- Configured source groups: Agent API
- Unavailable source groups: Management, Gateway
- Interventions: disabled
- Hermes mutation calls: `0`

## Result

The partial read-only acceptance passed for the authenticated Agent API at the safe loopback identity `http://127.0.0.1:8642`. The only live upstream Hermes endpoint reached was `GET /health/detailed`. The production review instance ran from the exact clean Commit A build on `127.0.0.1:4011` with isolated disposable Cabinet data.

Configured identity and observed identity are now separate. `CABINET_HERMES_PROFILE` establishes only the configured profile `operator-os`; it does not establish the active runtime profile. No available live source explicitly confirmed the active profile, so the observed active profile remains unknown.

Endpoint-confirmed and locally detected Agent identities are also separate. `/health/detailed` confirmed version `0.19.0` but did not report a running-process commit. The local checkout commit `d7b36070ef80` remains installation metadata and is not attributed to the running process.

## Source truth and requests

| Source group | State | Upstream requests | Result |
| --- | --- | ---: | --- |
| Agent API | Configured | 1 live endpoint category | `GET /health/detailed` returned the running version identity |
| Management | Unavailable | 0 | `Hermes Management is not configured for this review.` |
| Gateway | Unavailable | 0 | No direct Gateway source was configured or contacted |

The prior Hermes Agent 0.18.2 contract audit remains stale historical evidence. The successful live contract is source-specific: installed Agent 0.19.0 `GET /health/detailed`. Management remains unavailable with its prior audit stale; Gateway remains unavailable; Desktop `0.17.0` is separately detected. No global Desktop 0.18 compatibility claim is made.

Management-backed observations are represented by one typed unavailable source and 28 derived dependent capability observations. The Overview elevates one grouped Management exception, not 28 duplicate exceptions. The independent Gateway condition remains separately visible because Agent health indirectly reported Gateway running while no direct Gateway source was configured; the UI does not treat that indirect fact as direct Gateway proof.

Runtime execution now states: **“Runtime execution sources are unavailable. Active-run state is unknown.”** Zero displayed counts do not claim that zero runs exist.

## About and updates claim scope

The registry contract covers runtime identity, application metadata, and update-check interfaces. This review observed only `GET /health/detailed`, proving the runtime-version identity subclaim. Update checking was not performed and application update availability is unknown.

That partial observation does not satisfy the full visible capability semantics, so About and updates receives no Current Live Visibility or Live-Proven credit from this run. The decision is deterministic across the projection, generated matrix, browser, and tests.

## Parity

| Dimension | Result |
| --- | ---: |
| Discoverability | 48/48 (100%) |
| Current Live Visibility | 0/48 (0%) |
| Governed Management | 3/48 (6%) |
| Live-Proven | 3/48 (6%) |

The three retained Live-Proven credits are separately authorized historical-live proofs. No fixture or partial About observation earned current-live credit.

<!-- GENERATED:HERMES_LIVE_PROVEN_ATTRIBUTION:START -->
### Live-Proven attribution

Generated directly from the canonical capability projection.

| Capability ID | Classification | Evidence origin | Proof kind | Proof scope | Source | Interface | Observed at |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `command-center` | current | `raw_observation` | live | live_runtime_operation | Hermes detailed health bridge | /health/detailed | 2026-07-20T23:51:43.030Z |
| `approvals` | historical | `approved_evidence_catalog` | historical_audit | historical_live_acceptance | Cabinet Hermes M3-M7 acceptance suite | Hermes gateway and run decision contract | 2026-07-19T02:23:07Z |
| `browser-opencli` | historical | `approved_evidence_catalog` | historical_audit | historical_live_acceptance | OpenCLI read-only acceptance | opencli local page title, DOM read, and screenshot | 2026-07-19T20:18:51Z |
<!-- GENERATED:HERMES_LIVE_PROVEN_ATTRIBUTION:END -->

## Cabinet daemon distinction and live discrepancy

The visible daemon banner refers to Cabinet’s application agent daemon, not Hermes Agent. It now says: **“Cabinet agent daemon is unavailable. This is separate from the connected Hermes Agent runtime.”** The daemon was not restarted or hidden for this review.

During the live browser review, the Control Center repeatedly obtained the current Agent 0.19.0 identity while the independently polling status bar intermittently reported a Hermes health timeout. This discrepancy is preserved rather than suppressed. It did not change the source-specific projection result and requires follow-up outside this read-only closeout if it recurs in normal use.

## Verification

- Full unit suite: 585 passed, 0 failed.
- Focused Hermes and closeout regressions: passed.
- Production browser workflows: 4 passed, 0 failed.
- TypeScript: passed.
- Focused ESLint: passed.
- Exact Commit A production build: passed; the generated build identity contains `9c887115128904c3ca7d6ae8ed5d4fb1a9789b55`.
- `git diff --check`: passed.
- Live browser: desktop 1440×900 and mobile 390×844 passed; mobile horizontal overflow was 0 px.
- Reduced-motion workflow: passed.
- Relevant browser console/framework errors: none.
- Matrix, machine projection, and browser percentages agree at 100% / 0% / 6% / 6%.
- Management requests: 0. Gateway requests: 0. Hermes mutation calls: 0.
- Recursive credential and local-identity non-egress checks: passed.

Existing unrelated warnings remain: the production build emits the known Turbopack NFT trace warnings from the system file-picker import trace, and Playwright may emit its existing `NO_COLOR` / `FORCE_COLOR` notice.

## Evidence

- `live-runtime-projection.json`: sanitized canonical live projection from exact Commit A.
- `configuration-readiness.json`: credential-free configured, unavailable, and identity status.
- `live-artifact-manifest.json`: shared provenance for the evidence set.
- `live-agent-overview-1440x900.png`: desktop live Overview with grouped Management and independent Gateway exceptions.
- `live-agent-identity-inspector-1440x900.png`: desktop About inspector with identity and claim-scope separation.
- `live-agent-overview-mobile-390x844.png`: mobile live Overview.
- `live-agent-identity-mobile-390x844.png`: mobile live identity sheet.

The earlier `acceptance-report.md` remains the immutable Stage A safe-block record. This report is the Stage B partial Agent API closeout.
