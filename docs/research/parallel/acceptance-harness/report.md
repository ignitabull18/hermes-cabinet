# Production acceptance harness

Verdict: **NOT_ACCEPTED**

The runner exercised an isolated application build on port 4207. It sent 2 bounded live model message(s) and did not touch production or canonical data.

## Checks

| Area | Check | Status | Result |
| --- | --- | --- | --- |
| routes | route-manifest | PASSED | Discovered 15 application and SPA routes from exact source. |
| navigation | desktop-navigation | FAILED | Desktop navigation discovery failed: Error: expect(locator).toBeVisible() failed Locator: getByRole('heading', { name: 'Acceptance Cabinet' }) Expected: visible Timeout: 15000ms Error: element(s) not found Call log: - Expect "toBeVisible" with timeout 15000ms - waiting for getByRole('heading', { name: 'Acceptance Cabinet' }) |
| drawers | drawers-data-team | PASSED | Data and Team drawers changed selected state and rendered their target surfaces. |
| new | new-composer | PASSED | New opened one keyboard-usable conversation composer. |
| availability | search-terminal-unavailable | PASSED | Search and Terminal were visibly unavailable with zero Search/PTY requests. |
| tasks | tasks-route | PASSED | Tasks loaded standalone and nested, including reload. |
| routes | primary-application-routes | FAILED | A primary application route failed: Error: expect(locator).toContainText(expected) failed Locator: getByRole('alert') Expected pattern: /Cockpit exception\|Daily Business Intake is unavailable/ Error: strict mode violation: getByRole('alert') resolved to 2 elements: 1) <div role="alert" data-slot="alert" class="group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4 bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-curre |
| organization | org-chart | PASSED | Loaded the room overview that owns the Org-chart action. |
| organization | org-chart-trigger-present | PASSED | Found one visible Org-chart button by its accessible role and name. |
| organization | org-chart-trigger-enabled | PASSED | The Org-chart trigger was enabled for the isolated agent fixture. |
| organization | org-chart-trigger-click | PASSED | The enabled Org-chart trigger accepted a bounded click. |
| organization | org-chart-dialog | PASSED | The named Org-chart dialog opened after the trigger click. |
| organization | org-chart-bounds-and-close | PASSED | Org chart stayed viewport-bounded, closed by keyboard, and restored trigger focus. |
| Hermes | operator-mode | PASSED | Hermes Operator mode rendered against the non-mutating acceptance projection. |
| Skills | governed-skills | PASSED | Governed Skills rendered its real read-only state or a precise unavailable explanation with no mutation. |
| Hermes | hermes-operator-sections | PASSED | Opened 4 Hermes Operator sections: sessions/runs, memory, sources, and settings. |
| Developer | developer-diagnostics-48 | PASSED | Developer mode exposed exactly 48 diagnostic rows. |
| conversation | live-two-turn-contract | FAILED | Two-turn transport contract failed: Error: conversation failed (exitCode=124, errorKind=timeout) |
| restart | restart-route-persistence | PASSED | Isolated Cabinet restarted on port 4207 and the room route persisted. |
| supervision | launchd-child-restart | PASSED | The merged isolated launchd recovery evidence remains applicable and the complete current supervision suite passed. |
| navigation | history-navigation | PASSED | Back/forward navigation preserved route identity. |
| responsive | mobile-reduced-motion-overflow | PASSED | 390x844 reduced-motion room had 0px horizontal overflow. |
| network | legacy-daemon-output-accounting | PASSED | Observed 0 legacy daemon-output request(s). |
| routes | complete-route-inventory | FAILED | 8 route(s) were not accepted. |
| browser | console-health | FAILED | Relevant browser errors were observed. |
| safety | mutation-accounting | PASSED | Recorded 33 isolated HTTP mutation request(s); no production or governed Skill mutation was authorized. |

## Exact blockers

- `desktop-navigation-unavailable`: Desktop navigation discovery failed: Error: expect(locator).toBeVisible() failed Locator: getByRole('heading', { name: 'Acceptance Cabinet' }) Expected: visible Timeout: 15000ms Error: element(s) not found Call log: - Expect "toBeVisible" with timeout 15000ms - waiting for getByRole('heading', { name: 'Acceptance Cabinet' })
- `primary-route-failed`: A primary application route failed: Error: expect(locator).toContainText(expected) failed Locator: getByRole('alert') Expected pattern: /Cockpit exception|Daily Business Intake is unavailable/ Error: strict mode violation: getByRole('alert') resolved to 2 elements: 1) <div role="alert" data-slot="alert" class="group/alert relative grid w-full gap-0.5 rounded-lg border px-2.5 py-2 text-left text-sm has-data-[slot=alert-action]:relative has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2 *:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg:not([class*='size-'])]:size-4 bg-card text-destructive *:data-[slot=alert-description]:text-destructive/90 *:[svg]:text-curre
- `live-two-turn-contract-failed`: Two-turn transport contract failed: Error: conversation failed (exitCode=124, errorKind=timeout)
- `incomplete-route-inventory`: 8 discovered or required route(s) were not accepted.

## Accounting

- Requests: 1463
- Mutations observed: 33
- Legacy daemon-output requests: 0
- Search requests: 0
- PTY create/write requests: 0
- Developer diagnostics observed: 48
- Secret indicators: 0
- Local-path indicators: 0

## Recommendation

Resolve only the exact blockers above, then rerun the same bounded acceptance.
