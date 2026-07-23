# Production acceptance harness

Verdict: **NOT_ACCEPTED**

The runner exercised an isolated application build on port 4315. It sent 0 bounded live model message request(s) and did not touch production or canonical data.

## Checks

| Area | Check | Status | Result |
| --- | --- | --- | --- |
| routes | route-manifest | PASSED | Discovered 15 application and SPA routes from exact source. |
| navigation | desktop-navigation | PASSED | Discovered 16 visible desktop button labels. |
| drawers | drawers-data-team | PASSED | Data and Team drawers changed selected state and rendered their target surfaces. |
| new | new-composer | PASSED | New opened one keyboard-usable conversation composer. |
| availability | search-terminal-unavailable | PASSED | Search and Terminal were visibly unavailable with zero Search/PTY requests. |
| tasks | tasks-route | PASSED | Tasks loaded standalone and nested, including reload. |
| routes | primary-application-routes | PASSED | Loaded 7 independent application routes with deterministic Cockpit identity. |
| organization | org-chart | PASSED | Loaded the room overview that owns the Org-chart action. |
| organization | org-chart-trigger-present | PASSED | Found one visible Org-chart button by its accessible role and name. |
| organization | org-chart-trigger-enabled | PASSED | The Org-chart trigger was enabled for the isolated agent fixture. |
| organization | org-chart-trigger-click | PASSED | The enabled Org-chart trigger accepted a bounded click. |
| organization | org-chart-dialog | PASSED | The named Org-chart dialog opened after the trigger click. |
| organization | org-chart-bounds-and-close | PASSED | Org chart stayed viewport-bounded, closed by keyboard, and restored trigger focus. |
| Hermes | operator-mode | PASSED | Hermes Operator mode rendered against the non-mutating acceptance projection. |
| Skills | governed-skills | FAILED | Governed Skills surface failed: Error: expect(locator).toContainText(expected) failed Locator: getByTestId('hermes-skills-fixture-label') Expected substring: "no live Hermes mutation performed" Timeout: 15000ms Error: element(s) not found Call log: - Expect "toContainText" with timeout 15000ms - waiting for getByTestId('hermes-skills-fixture-label') |
| Hermes | hermes-operator-sections | PASSED | Opened 4 independently scoped Hermes Operator sections. |
| Developer | developer-diagnostics-48 | PASSED | Developer mode exposed exactly 48 diagnostic rows. |
| conversation | live-two-turn-contract | FAILED | Two-turn transport contract failed: Error: expect(received).toBe(expected) // Object.is equality Expected: "CABINET_ACCEPTANCE_OK" Received: "API call failed after 3 retries: HTTP 404: model \"\" not found" |
| conversation | conversation-direct-reload-persistence | BLOCKED | Blocked by the unavailable live two-turn conversation result. |
| restart | restart-route-persistence | PASSED | Isolated Cabinet restarted on port 4315 and the room route persisted. |
| supervision | launchd-child-restart | PASSED | The complete isolated supervision recovery suite passed without touching launchd. |
| navigation | history-navigation | PASSED | Back/forward navigation preserved route identity. |
| responsive | mobile-reduced-motion-overflow | PASSED | 390x844 reduced-motion room had 0px horizontal overflow. |
| network | legacy-daemon-output-accounting | PASSED | Observed 0 legacy daemon-output request(s). |
| routes | complete-route-inventory | FAILED | 2 route(s) were not accepted. |
| browser | console-health | FAILED | 11 relevant browser issue(s) were observed with stage ownership. |
| safety | mutation-accounting | PASSED | Recorded 30 isolated HTTP mutation request(s) and 0 consequential Hermes mutation(s). |

## Exact blockers

- `live-two-turn-contract-failed`: Two-turn transport contract failed: Error: expect(received).toBe(expected) // Object.is equality Expected: "CABINET_ACCEPTANCE_OK" Received: "API call failed after 3 retries: HTTP 404: model \"\" not found"
- `incomplete-route-inventory`: 2 discovered or required route(s) were not accepted.
- `application-diff-outside-owned-lane`: Application or shared files differ from acceptance base 5e94de3e1c789279459c704d4a7f0fa61c747163.

## Accounting

- Requests: 1748
- Mutations observed: 30
- Legacy daemon-output requests: 0
- Search requests: 0
- PTY create/write requests: 0
- Model message requests: 0
- Consequential Hermes mutations: 0
- Relevant browser issues: 11
- Developer diagnostics observed: 48
- Secret indicators: 0
- Local-path indicators: 0

## Recommendation

Do not rerun this bounded acceptance in the current wave. Exactly one live attempt was
authorized and consumed.

## Post-run disposition

This section records the authoritative interpretation made after preserving the raw
generated artifact:

- The persistence contract itself completed checkpoints A-H. Durable cardinality was
  1 user / 1 assistant at B-D, 2 users / 1 assistant while the accepted follow-up was
  running at E, and exactly 2 users / 2 completed assistants at F-H. The native session
  fingerprint stayed stable, the second Cabinet restart completed, and no duplicate
  turn identities were observed.
- Cabinet attempted exactly two prompt dispatches: one initial submission and one
  follow-up. The generated `0` model-message count is a recorder limitation because
  those requests originate in the Node transport rather than the observed browser page.
  The harness now merges its content-free transport ledger count into network accounting.
- The live provider response reported an empty model identity and internal retry
  behavior before returning HTTP 404. Therefore the exact-token and zero-retry
  requirements failed even though the conversation rows remained durable.
- The Skills failure, controlled-restart console noise, and integration-diff blocker
  were harness defects exposed by this run. Static corrections now install the explicit
  read-only Skills fixture for live transport, tag both transport-owned restarts, and
  honor the runner's explicit integration-diff opt-in. These corrections were verified
  without a model-bearing rerun.
- In-memory turn counts and pending-required-write counts were not exposed by the live
  detail API, so those two requested measurements remain unavailable rather than being
  inferred from durable rows.
- Production and canonical data were untouched. No Hermes mutation, PTY mutation,
  deployment, merge, push, or pull request was performed.
