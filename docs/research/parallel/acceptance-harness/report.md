# Production acceptance harness

Verdict: **NOT_ACCEPTED**

The runner exercised an isolated exact-main application build on port 4207. It sent zero live model messages and did not touch production or canonical data.

## Checks

| Area | Check | Status | Result |
| --- | --- | --- | --- |
| routes | route-manifest | PASSED | Discovered 12 application and SPA routes from exact source. |
| navigation | desktop-navigation | PASSED | Discovered 22 visible desktop button labels. |
| drawers | drawers-data-team | PASSED | Data and Team drawers changed selected state and rendered their target surfaces. |
| new | new-composer | PASSED | New opened one keyboard-usable conversation composer. |
| availability | search-terminal-unavailable | PASSED | Search and Terminal were visibly unavailable with zero Search/PTY requests. |
| tasks | tasks-route | PASSED | Tasks loaded standalone and nested, including reload. |
| organization | org-chart | PASSED | Loaded the room overview that owns the Org-chart action. |
| organization | org-chart-trigger-present | PASSED | Found one visible Org-chart button by its accessible role and name. |
| organization | org-chart-trigger-enabled | PASSED | The Org-chart trigger was enabled for the isolated agent fixture. |
| organization | org-chart-trigger-click | PASSED | The enabled Org-chart trigger accepted a bounded click. |
| organization | org-chart-dialog | PASSED | The named Org-chart dialog opened after the trigger click. |
| organization | org-chart-bounds-and-close | PASSED | Org chart stayed viewport-bounded, closed by keyboard, and restored trigger focus. |
| Hermes | operator-mode | PASSED | Hermes Operator mode rendered against the non-mutating acceptance projection. |
| Skills | governed-skills | PASSED | Governed Skills rendered with explicit fixture provenance and no live mutation. |
| Developer | developer-diagnostics-48 | PASSED | Developer mode exposed exactly 48 diagnostic rows. |
| conversation | fixture-two-turn-contract | PASSED | Fixture transport exercised exact prompts without a model: "This is a local Cabinet transport acceptance test. Do not use tools or contact external systems. Reply with exactly CABINET_TRANSPORT_OK." then "Reply with the exact transport token from your previous response.". |
| conversation | live-two-turn-contract | BLOCKED | No transport passed the mandatory live gate; zero live model messages were sent. |
| restart | restart-route-persistence | PASSED | Isolated Cabinet restarted on port 4207 and the room route persisted. |
| supervision | launchd-child-restart | BLOCKED | Production launchd child recovery is outside the isolated harness and remains a known blocker. |
| navigation | history-navigation | PASSED | Back/forward navigation preserved route identity. |
| responsive | mobile-reduced-motion-overflow | PASSED | 390x844 reduced-motion room had 0px horizontal overflow. |
| network | legacy-daemon-output-accounting | PASSED | Observed 0 legacy daemon-output request(s). |
| browser | console-health | PASSED | No relevant browser errors were observed. |
| safety | mutation-accounting | PASSED | Recorded 20 isolated HTTP mutation request(s); no production or governed Skill mutation was authorized. |

## Exact blockers

- `no-live-transport-passed-mandatory-gate`: The exact live two-turn conversation, same-session resume, and live persistence are blocked.
- `launchd-child-restart-not-proven`: The supervised wrapper is not proven to recover after the Next child exits.

## Accounting

- Requests: 1008
- Mutations observed: 20
- Legacy daemon-output requests: 0
- Search requests: 0
- PTY create/write requests: 0
- Developer diagnostics observed: 48
- Secret indicators: 0
- Local-path indicators: 0

## Recommendation

Integrate this harness after the transport, supervision, drawer/mobile, and polling streams land. Keep the live transport disabled until one candidate passes the mandatory live gate, then rerun with that explicitly registered transport.
