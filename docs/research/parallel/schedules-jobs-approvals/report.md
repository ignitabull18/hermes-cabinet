# Schedules, jobs, runs, approvals, and queues management audit

## Executive result

Hermes has useful native primitives, but it does **not** expose one coherent
management plane for all of these resources. Cabinet must preserve four distinct
planes:

1. **Cron schedules and durable execution attempts**: durable, profile-local
   records with list and known-ID management.
2. **Agent API runs**: short-lived, process-local live control by known run ID;
   no global run enumeration, retry, or resume route.
3. **TUI pending inputs and background processes**: live session-local
   JSON-RPC/events; approval targeting is FIFO by session, while clarify
   responses have an exact request ID.
4. **Kanban workers/runs**: a separate plugin subsystem with its own board and
   worker lifecycle. It must not be merged with cron executions or Agent API
   runs.

The immediate Cabinet priority is a read-only normalized inventory plus
capability declarations. Schedule writes can follow with preview,
confirmation, idempotency, stale-state rejection, and post-read verification.
Approval mutation must stay blocked until Hermes exposes immutable approval
request IDs. Agent-run stop is cooperative and was explicitly excluded from
this stream.

## Evidence boundary

- Cabinet base: `origin/main` at
  `3c3193a44a34dbe7b047ddd256e3d1aec31e1097`.
- Installed Hermes: `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`,
  reported as Hermes Agent `0.19.0 (2026.7.20)`.
- Audit inputs: the exact installed Git checkout under
  `<user-home>/.hermes/hermes-agent`, its official checked-in
  documentation, and the isolated fixture prototype in this stream.
- No production, environment, credential, schedule, job, run, queue, approval,
  clarification, worker, or service state was changed.

## Interface and enumeration matrix

| Resource | Desktop Management API | Native Agent API | TUI/native gateway | CLI/store | Enumeration conclusion |
|---|---|---|---|---|---|
| Cron schedules | `GET /api/cron/jobs?profile=all`; known ID; create/update/pause/resume/trigger/delete | `GET /api/jobs` and known-ID CRUD/pause/resume/run | Not the canonical schedule inventory | `hermes cron list --all` and profile-scoped commands | Global cross-profile enumeration exists only in Desktop Management. Agent API and CLI/store are profile-local. |
| Cron run sessions | Known-job `GET /api/cron/jobs/{id}/runs`, backed by session IDs with `cron_{job_id}_...` | None | Session lifecycle can be observed only while attached | Session DB | Known-job retrospective conversation sessions, not the durable execution-attempt ledger. |
| Cron execution attempts | Latest attempt is attached to schedule records | Trigger returns a job record, not an execution result | None | Durable `cron/executions.py` ledger and `hermes cron runs [job]` | Profile-local history can be enumerated, optionally by job. It is an audit ledger, not a retry queue. |
| Agent API runs | Not a coherent global inventory | `POST /v1/runs`; known-ID status, SSE, approval, stop | TUI sessions have their own live lifecycle | No durable global Agent-run list | Known-ID-only. Terminal status lasts 3,600 seconds; orphaned event transport lasts 300 seconds. |
| Pending approvals | Events may be visible to the attached desktop session | Per-run approval route | `approval.request` event and `approval.respond` | Internal queue | No global enumeration. Current mutation targets oldest/all approvals in a session, not an immutable request ID. |
| Pending clarifications | Attached-session prompt only | Clarify tool is dropped for API Server | `clarify.request` carries exact `request_id`; `clarify.respond` resolves it | Internal gateway queue | Known request ID while attached; no global historical enumeration. |
| Prompt/message queues | Session UI state | No global queue list | Session-scoped queued turns/process state | Internal FIFO/session state | Treat as live metadata only. Queue contents are content-bearing and should not be copied into management inventory. |
| Background processes | Session UI | Not the same as Agent runs | `process.list`/`process.kill` are session scoped; `process.stop` is global kill-all | In-memory process registry | Session-scoped live inventory. Global stop is too broad for Cabinet. |
| Kanban workers/runs | Plugin routes | Separate from `/v1/runs` | Separate worker process model | Kanban DB | Board/plugin subsystem. `GET /workers/active` exists; termination is out of scope and can expose host process metadata. |

## Primary contract findings

### Cron schedules

`hermes_cli/web_server.py:11988-12226` exposes list, known-ID read,
create, update, pause, resume, trigger, and delete. The list path defaults to
`profile=all` and iterates every configured profile
(`hermes_cli/web_server.py:11960-11998`). Cross-profile results are annotated
with `profile_name` and `hermes_home`
(`hermes_cli/web_server.py:11916-11946`). Cabinet should retain the profile
identifier but suppress the host path.

The same schedule operations are available under API-key authentication at
`/api/jobs` in `gateway/platforms/api_server.py:1581-1588` and
`gateway/platforms/api_server.py:4234-4437`. These routes are profile-local and
do input validation, but do not provide compare-and-swap revisions or an
idempotency key. A Cabinet coordinator therefore needs its own pre-read
fingerprint and receipt store.

The Desktop Management API is valuable as a contract reference and as the only
native cross-profile list, but its loopback mode uses an ephemeral SPA session
token (`hermes_cli/web_server.py:383-407`). It is not a durable Cabinet
service-to-service boundary.

### Durable execution history versus run sessions

`cron/executions.py:1-4` explicitly defines a profile-local audit ledger, not a
retry queue. An attempt is persisted as `claimed` before dispatch, can become
`running`, and terminates as `completed`, `failed`, or `unknown`.
Recovery changes an abandoned attempt to `unknown` only after the exact owner
process is proven gone, and never retries it
(`cron/executions.py:104-181`). History is indexed, newest-first, globally
within the profile or filtered by job, with a maximum page size of 500
(`cron/executions.py:184-205`).

Desktop's known-job `/runs` route is different: it reads ordinary SessionDB
sessions whose IDs start with `cron_{job_id}_`
(`hermes_cli/web_server.py:12012-12057`). Cabinet should expose both only with
unambiguous names such as `executionAttempts` and `conversationSessions`.

Execution rows contain `pid`, `process_id`, and raw `error`. Those are useful
internally but should be omitted or redacted from ordinary management payloads.

### Agent API live runs

The native routes are declared at
`gateway/platforms/api_server.py:1589-1593`. Hermes can start a run, poll one
known run ID, stream its events, resolve that run's approval queue, and request
a stop. There is no `GET /v1/runs`, retry, or resume route.

The event transport is retained for 300 seconds and terminal status for 3,600
seconds (`gateway/platforms/api_server.py:4836-4840`,
`gateway/platforms/api_server.py:5430-5474`). This is live process state, not a
durable global history. Output, errors, deltas, tool progress, and approval
events are content-bearing and must not be copied into an inventory response by
default.

Stop sets status to `stopping`, records the request, and calls the agent's
cooperative interrupt (`gateway/platforms/api_server.py:5407-5428`). Only a
later `cancelled` state proves termination. `stopping` is not terminal and can
persist until the agent thread observes the interrupt. Therefore any future
governed cancel flow must poll for the exact `cancelled` terminal state and
return `outcome_unknown` if that cannot be observed. This stream performed no
termination.

### Approvals and clarifications

Agent API approval handling is per run, but calls
`resolve_gateway_approval(session_key, choice, resolve_all=...)`
(`gateway/platforms/api_server.py:5319-5399`). The underlying queue resolves
the oldest approval in FIFO order or all approvals in the session
(`tools/approval.py:2020-2109`). TUI `approval.respond` has the same behavior
(`tui_gateway/server.py:11737-11756`). There is no immutable approval request
ID in the mutation contract. Cabinet cannot safely preview one exact approval
and later prove it resolved that same approval, so approval mutation is blocked.
`resolve_all` should never be offered.

TUI clarifications are safer to target. The blocking prompt factory emits a
fresh `request_id` and keeps pending state by that ID
(`tui_gateway/server.py:2414-2440`); `clarify.respond` requires that exact ID
(`tui_gateway/server.py:11703-11719`). This remains process-local and
attachment-dependent. Question, choices, and answer are content-bearing;
inventory and receipts should retain only IDs, state, timestamps, and digests.

Hermes's own docs reinforce the interface split: TUI JSON-RPC is the full
interactive host surface, while the API Server drops `clarify` for
programmatic access
(`website/docs/developer-guide/programmatic-integration.md:40-108`;
`website/docs/user-guide/messaging/index.md:582`). Cron prompts must be
self-contained because scheduled jobs cannot clarify
(`website/docs/developer-guide/cron-internals.md:180`).

### Queues, processes, and Kanban workers

TUI process inspection is session-scoped via `process.list`, and exact process
kill is session-owner checked. `process.stop`, however, calls global
`kill_all()` (`tui_gateway/server.py:13236-13294`) and is unsuitable for a
Cabinet action.

Kanban has a separate active-worker route and run-termination route
(`plugins/kanban/dashboard/plugin_api.py:1351` and `:1506`). It is not an
alternate global Agent-run API. Active-worker data can include PID, profile,
task, heartbeat, and other host metadata, so Cabinet needs a minimal projection.
No Kanban termination was tested or modeled as dispatchable.

## Governed action contract

The fixture prototype implements the reusable coordinator shape for supported
actions:

1. Read the exact target and create a canonical fingerprint.
2. Produce a safe preview with action, target, proposed change, and a typed
   confirmation string bound to the plan fingerprint.
3. On confirmation, re-read and block stale state before dispatch.
4. Dispatch at most once for the idempotency key.
5. Re-read the authoritative target or durable execution ID.
6. Return `verified` only when the postcondition is proven; otherwise return
   `outcome_unknown` and do not retry.
7. Persist and replay the same receipt for duplicate idempotency keys.

The prototype supports create, update, pause, resume, trigger, delete, and exact
clarification resolution against in-memory fixtures. It deliberately rejects:

- approval resolution, because upstream targeting is FIFO by session;
- Agent-run retry and resume, because no native routes exist;
- governed run cancellation, because termination is excluded from this stream.

It includes a pure cancellation verifier so a future authorized flow cannot
mistake `stopping` for `cancelled`.

The preview and receipt omit raw prompts, commands, answers, queue contents,
output, and errors. A production dispatcher would keep sensitive request
content behind a short-lived opaque `payloadRef`; only hashes belong in the
governance record.

## Cabinet implementation priority

1. **P0 — normalized read-only inventory and capability map**
   - Cross-profile schedules via an authenticated, durable native boundary.
   - Profile-local durable execution attempts, distinctly named.
   - Known-ID live Agent run lookup with expiry surfaced.
   - Session-scoped pending-input/process metadata only when attached.
   - Separate Kanban worker inventory.
   - Per-field redaction and provenance for every row.
2. **P0 — governance substrate**
   - Canonical fingerprints, typed confirmation, immutable receipts,
     idempotency keys, stale-state block, one-dispatch rule, and
     `outcome_unknown`.
3. **P1 — schedule mutations**
   - Create/update/pause/resume/delete with exact post-read.
   - Trigger only when a durable execution attempt ID or correlation can be
     read back; never retry an ambiguous trigger.
4. **P1 — upstream contract improvements**
   - Durable authenticated Cabinet/Agent boundary for cross-profile schedule
     enumeration without `hermes_home`.
   - Immutable approval request IDs plus exact `GET` and resolve-by-ID.
   - Durable or explicitly unsupported global Agent-run inventory.
5. **P2 — live controls**
   - Clarification response by exact request ID with content isolation.
   - Run cancellation only after separate authorization and terminal-state
     verification.
   - Keep approval actions disabled until exact targeting exists.

## Common deliverables for integration

- Resource identity must include `plane`, `profile`, and native ID; IDs from
  cron executions, SessionDB runs, Agent API runs, and Kanban runs are not
  interchangeable.
- Every adapter declares `enumerationScope`, `knownIdRead`, `durability`,
  `contentBearingFields`, `supportedActions`, and `verificationContract`.
- Default list payloads contain metadata only. Host paths, PID/process IDs,
  raw errors, prompts, commands, output, answers, and queue contents are
  redacted or excluded.
- A shared receipt schema records plan fingerprint, idempotency key, target,
  dispatch count, verification evidence, outcome, and whether retry is allowed.
- Unsupported operations are first-class capability results, not hidden UI
  buttons or best-effort fallbacks.

## Verification

From `experiments/management/schedules-jobs-approvals`:

```text
npm test
13 tests passed; 0 failed
```

Coverage includes interface separation, exact confirmation, stale-state
rejection, idempotent receipt replay, post-timeout verification,
`outcome_unknown` without retry, content-safe clarification handling, unsafe
approval rejection, unsupported retry/resume, and cancellation verification
without termination.
