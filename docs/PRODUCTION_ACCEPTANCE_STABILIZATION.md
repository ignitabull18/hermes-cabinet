# Production acceptance stabilization

This document records the bounded blocker trace captured from the exact pre-change production revision. It excludes credentials, private data, local paths, and conversation content.

| Surface | Route and action | Client request | Server route | Runtime dependency | Bounded observed failure | Why coverage missed it |
| --- | --- | --- | --- | --- | --- | --- |
| Operator conversation | `/room/operator-cabinet`, submit composer | Conversation create/continue request and conversation polling | `/api/agents/conversations` and its continuation route | `hermes_runtime` opened the Hermes TUI Gateway and required unavailable Gateway and Management configuration | `fetch failed` | Adapter tests modeled Gateway events but did not execute the production route with the degraded installed topology. |
| Tasks | `/tasks`, direct load | Tasks board data requests after render | Tasks APIs used by `TasksBoard` | React `TaskRailProvider` context | `useTaskRail must be used within <TaskRailProvider>` | Normal app-shell navigation supplied the provider; direct-route coverage did not render the standalone page. |
| Org chart | Operator room, open Team org chart | Cabinet overview data already loaded by the room | No additional mutation route | Base UI portal and responsive layout | Content could exceed the mobile viewport and place controls off-screen | Desktop-only checks did not exercise the overlay at 390 by 844 or assert viewport overflow and focus restoration. |
| Search, New, Developer | Main Search, sidebar New, Hermes mode switch | Search issues no request in Hermes mode; New opens the global composer; Developer reads Control Center | `/api/hermes/control-center` for Developer diagnostics | Search is legacy-daemon-only; New must use the Hermes conversation path; Developer is Cabinet-local state | Search availability was easy to misread, New offered knowledge creation rather than an operator conversation, and Developer mode was not URL-backed | Pointer-only smoke checks lacked keyboard, reload, URL-state, unavailable-state, and request-count assertions. |
| Process supervision | Start Cabinet from a controlling terminal, then end the parent | Browser health request after parent exit | Next application routes | Controlling terminal process tree | Cabinet exited with its parent because no repository-supported supervisor contract existed | Development startup tests proved boot, not independence from the invoking terminal or restart and unload behavior. |

The stabilization selects native Hermes ACP over stdio for execution. A narrow companion patch adds a process-owned no-tools switch before MCP discovery because the installed ACP bundle otherwise exposes standard tools. Cabinet connects through the official `@agentclientprotocol/sdk`, supplies a dedicated absolute ACP executable, fixes the server-owned profile, and passes only the provider credential required by that process. The client rejects advertised terminal/filesystem capabilities, permission requests, tool events, malformed or oversized frames, duplicate chunks, and incomplete streams.

Cabinet keeps one ACP process per active session for consecutive turns. After a
Cabinet process restart, it starts a new ACP process and loads the persisted
native session before continuing. Browser input cannot author the executable,
profile, environment, or tool policy.

The authoritative harness runs from
`scripts/production-acceptance/run.mjs`. Fixture mode validates orchestration
only and can never produce an accepted verdict. Integration acceptance must
select `CABINET_ACCEPTANCE_TRANSPORT=acp`, run on the exact stabilization
branch with `CABINET_ACCEPTANCE_ALLOW_INTEGRATION_DIFF=1`, and use isolated
Cabinet data, an isolated home, port 4207, and the dedicated companion
executable. Its report records the live-message count, complete route
inventory, desktop/mobile behavior, restart persistence, browser errors,
legacy polling, and credential/local-path scans.
