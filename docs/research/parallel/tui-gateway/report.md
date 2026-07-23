# Hermes TUI Gateway JSON-RPC transport probe

## Outcome

**Status: LIVE_READY.** Static checks and an isolated socket fixture pass. The
authorized real-model two-turn acceptance has deliberately not been run. Until
the overseer serializes that run, the mandatory transport conditions are not
accepted and this research branch is not a merge candidate.

The installed TUI gateway is the strongest native Hermes conversation and
management boundary found in this stream, but it has one material contract gap:
Hermes cannot express an empty TUI toolset through its documented environment
or JSON-RPC surface. The disposable sidecar pins the installed agent factory to
an explicit empty list and the client independently rejects any advertised
tool inventory, `tool.*` event, or `subagent.*` event.

## Audited baseline and primary sources

- Cabinet base: `3c3193a44a34dbe7b047ddd256e3d1aec31e1097`.
- Installed Hermes: `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`.
- Exact installed source: `tui_gateway/server.py`, `tui_gateway/ws.py`,
  `tui_gateway/entry.py`, `tui_gateway/transport.py`,
  `hermes_cli/profiles.py`, and `hermes_cli/auth.py`.
- Official Hermes integration guide:
  <https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/website/docs/developer-guide/programmatic-integration.md>
- Official Hermes CLI reference:
  <https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/website/docs/reference/cli-commands.md>
- JSON-RPC 2.0 specification: <https://www.jsonrpc.org/specification>.
- FastAPI WebSocket documentation:
  <https://fastapi.tiangolo.com/advanced/websockets/>.

No claim below relies on an older rollout note. The prior Cabinet memory was
used only as a safety reminder that a green health check is not conversation
acceptance.

## Exact native contract

### Start command and ownership

The installed, supported headless command is:

```text
hermes --profile operator-os serve --host 127.0.0.1 --port 4202 --isolated --skip-build
```

`hermes serve` owns a FastAPI/Uvicorn backend and mounts the same
`tui_gateway.ws.handle_ws` dispatcher used by Hermes Desktop. The lower-level
stdio custom-host command is `python -m tui_gateway.entry`. The WebSocket mount
emits `gateway.ready` immediately, then accepts JSON-RPC 2.0 request objects and
returns responses plus `method: "event"` notifications.

This experiment does not call `hermes serve`, because its no-tools contract is
insufficient. It mounts the exact installed `handle_ws` at `/rpc` in a
loopback-only Uvicorn process, fixed to port 4202. It refuses another host,
another port, another live profile, or an already-owned port. It does not
inspect, stop, or contact existing gateway processes.

### Conversation lifecycle and events

- `session.create` returns a short live `session_id`, durable
  `stored_session_id`, initial messages, and session info.
- `prompt.submit` returns `status: streaming`; asynchronous notifications carry
  `message.start`, `message.delta`, reasoning/thinking/status updates,
  `message.complete`, errors, tool lifecycle, approvals, clarification, sudo
  and secret prompts, and `session.info`.
- `session.resume` reads the profile-scoped `state.db`, restores transcript and
  stored runtime identity, creates/reuses a live session, and rebinds the
  current WebSocket transport.
- `session.history`, `session.active_list`, `session.usage`,
  `session.context_breakdown`, and `session.status` expose conversation/run
  state. Live payloads include in-flight and queued-prompt projections.
- `session.interrupt` cooperatively interrupts the model, clears the queued
  prompt and pending interaction, and denies unresolved approvals.
- `approval.respond`, `clarify.respond`, `sudo.respond`, `secret.respond`, and
  `terminal.read.respond` resolve blocking agent callbacks.

The client bounds open, ready, RPC, turn, close, frame size, and event count. It
requires JSON-RPC 2.0 envelopes, object results, matching IDs, valid event
types, `message.start` before streamed content, and a terminal completion. It
deduplicates identical event envelopes by SHA-256 of canonical event params and
records duplicate count rather than rendering duplicates.

### Profile and secret behavior

`session.create` and `session.resume` accept `profile`. Hermes resolves that to
the named profile home and rebinds `HERMES_HOME` for agent construction, DB
access, and each turn. The live harness additionally starts the process with
`operator-os` and requires the hydrated `session.info.profile_name` to equal
`operator-os`; a wrong profile is fatal.

Provider resolution reads profile-scoped configuration/auth state and may use
Hermes' documented global-root/shared auth fallback. The probe never reads,
copies, prints, or serializes credential values. Sidecar stdout/stderr are
discarded during acceptance, result output contains only timings, bounded
memory, transport facts, and the generated acceptance label.

### Reconnect and restart durability

On WebSocket disconnect, non-`close_on_disconnect` sessions are detached and
held for Hermes' bounded orphan grace window. A quick `session.resume` rebinds
transport ownership. Across a sidecar process restart, in-memory live state is
lost, but the first turn is persisted in the profile `state.db`; a new process
can resume by `stored_session_id`.

The guarded live harness proves the stronger case: first turn, client close,
sidecar termination, fresh sidecar process, durable resume, transcript check,
and follow-up. That proof remains pending until the overseer runs it.

## No-tools result

Stock behavior is blocked. `_load_enabled_toolsets()` treats an empty
`HERMES_TUI_TOOLSETS` as unspecified; an unknown selection falls back to
configured CLI toolsets; an empty configured set ultimately becomes `None`,
which means all available tools. `session.create` has no per-session toolset or
`tool_choice` parameter.

The experiment applies a process-local pin:

```python
server._load_enabled_toolsets = lambda: []
run_agent.get_tool_definitions = lambda **_kwargs: []
```

Both pins are armed before Uvicorn accepts a WebSocket, so the schema generator
is already forced empty before a session can perform provider resolution or
model activity. It also replaces WebSocket-started MCP discovery with a no-op
before `handle_ws` can import/call it; no MCP discovery occurs first. The real
`AIAgent` constructor receives `enabled_toolsets=[]`, and its tool definition
lookup is independently forced to `[]`. Provider adapters therefore have no
tool schemas to send on the first model request. Acceptance then requires
hydrated `tools` to be empty and forbids all tool/subagent events. The isolated
fixture uses Hermes' installed synthetic agent seam, which has an empty tool
list and performs no model, credential, tool, MCP, or external call.

This is adequate for a disposable acceptance probe. Production adoption should
add an upstream, supported explicit no-tools option rather than retain a private
monkey patch.

## Management breadth

| Surface | Native JSON-RPC breadth | Finding |
| --- | --- | --- |
| Conversations/runs | create, resume, list, history, active list, status, usage, interrupt, steer, redirect, branch, compress, close | Strong |
| Approvals | request events plus `approval.respond`; clarify/sudo/secret response methods | Strong |
| Queues | accepted next prompt and in-flight state projected per live session | Partial; no general durable queue API |
| Schedules | `cron.manage` | Present, mutating |
| Settings | `config.get`, `config.set`, `config.show`, tools configuration/reload | Broad, mutating |
| Models/providers | runtime check, model options/switch/key/disconnect, session info | Broad |
| Plugins/MCP/Skills | list/manage/reload/configure methods | Broad, mutating |
| Gateway lifecycle | none for service install/start/stop/restart/status | Missing; process supervisor must own it |

The method namespace is substantially broader than a conversation-only
transport. Cabinet would still need governance wrappers, preview/confirm,
stale-state checks, and explicit authorization before exposing mutators.

## Fixture verification

The socket fixture starts only the disposable sidecar with a temporary
`HERMES_HOME`, uses Hermes' installed synthetic agent, and covers:

- real WebSocket accept and `gateway.ready`;
- real JSON-RPC dispatch, create and status;
- ordered streaming and completion;
- explicit no-tool/no-subagent event check;
- cooperative cancellation and interrupted completion;
- unknown-method error framing;
- malformed envelopes, oversized frames, event-envelope validation;
- identical-event deduplication;
- bounded request failure;
- loopback and fixed-port guards.

Result: **8 tests passed**. Python compilation also passed. No real model
request was made.

## Common rubric

Current score is **66/100, provisional**. A failing or unrun mandatory
condition cannot win.

| Criterion | Score | Basis |
| --- | ---: | --- |
| Two-turn correctness | 0/20 | Guarded live test prepared, not run |
| Session durability across Cabinet restart | 10/15 | Native persistence audited; restart harness prepared |
| Streaming correctness/deduplication | 9/10 | Ordered synthetic stream and client validation pass |
| No-tools enforcement | 8/10 | Hard pin and fixture pass; real-model zero-event proof pending |
| Failure/cancellation semantics | 9/10 | Bounded errors and synthetic interrupt pass |
| Native Hermes fit | 10/10 | Exact installed Desktop/TUI dispatcher |
| Future management breadth | 8/10 | Broad methods; gateway lifecycle missing |
| Operational simplicity | 3/5 | Native `serve` is simple; no-tools needs wrapper |
| Security boundary | 5/5 | Loopback, fixed port/profile, bounded frames, no secret output |
| Maintenance burden | 4/5 | Thin wrapper, but private no-tools seam is revision-sensitive |

If the guarded live acceptance passes, the expected score is 93/100. That
projection is not a result.

## Blockers and recommendation

Blockers:

1. The serialized real-model acceptance is pending.
2. Explicit no-tools is not a supported native TUI gateway setting.
3. Gateway lifecycle is outside this JSON-RPC namespace.

Recommendation: prefer the TUI Gateway WebSocket JSON-RPC interface as
Cabinet's leading durable Hermes runtime candidate, contingent on the serialized
live pass and an upstream/native explicit no-tools contract. Keep gateway
lifecycle under a separate supervised process boundary and wrap all management
mutators with Cabinet governance.

## Overseer live command

Run only when the overseer has serialized this transport's authorized turn:

```bash
cd /Users/ignitabull/projects/worktrees/hermes-cabinet-parallel/tui-gateway && /Users/ignitabull/.hermes/hermes-agent/venv/bin/python experiments/transports/tui-gateway/probe.py --python /Users/ignitabull/.hermes/hermes-agent/venv/bin/python --sidecar /Users/ignitabull/projects/worktrees/hermes-cabinet-parallel/tui-gateway/experiments/transports/tui-gateway/sidecar.py --hermes-source /Users/ignitabull/.hermes/hermes-agent --output /tmp/hermes-cabinet-tui-gateway-live-result.json --confirm-live
```

The harness refuses an existing port-4202 listener. It runs exactly the
authorized initial prompt and follow-up, sequentially, with a sidecar restart
between them.

## Safety confirmation

Production Cabinet, canonical Cabinet data, `.cabinet.env`, Hermes source,
Hermes services, launchd jobs, gateway jobs, existing gateways, Skills,
settings, schedules, providers, models, MCP, plugins, and UI were not modified.
Port 4000 was not used. The only writes are in this stream's owned experiment
and research-report directories plus temporary fixture homes.
