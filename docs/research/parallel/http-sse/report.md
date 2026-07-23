# Profile-scoped HTTP/SSE transport probe

## Outcome

Status: **blocked pending serialized live acceptance**.

The installed Hermes revision `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`
contains a native `APIServerAdapter` that can be instantiated directly as a
loopback-only sidecar without starting `hermes gateway`, launchd, a dispatcher,
webhooks, or other messaging adapters. The fixture probe bound only
`127.0.0.1:4203`, exercised the real Hermes HTTP routes and SSE writers, reused
one session for two turns, and recovered that session after destroying and
recreating the adapter against the same isolated home.

The authorized model-backed two-turn acceptance was intentionally not run.
Therefore the transport does not meet the mandatory pass gate yet and is not a
merge candidate.

## Exact audited source

- Cabinet baseline: `3c3193a44a34dbe7b047ddd256e3d1aec31e1097`
- Installed Hermes: `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`
- Main implementation: `gateway/platforms/api_server.py`
- Profile/config contracts: `hermes_constants.py`,
  `hermes_cli/profiles.py`, `hermes_cli/tools_config.py`,
  `gateway/config.py`, and `gateway/run.py`
- Installed primary documentation:
  `website/docs/developer-guide/programmatic-integration.md` and
  `website/docs/user-guide/features/api-server.md`
- Official upstream source:
  [Hermes API server](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/gateway/platforms/api_server.py)
- Protocol references:
  [WHATWG Server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html) and
  [OpenAI Responses streaming events](https://platform.openai.com/docs/api-reference/responses-streaming)

## HTTP contract

The native adapter exposes these conversation/control endpoints:

| Method | Endpoint | Contract |
| --- | --- | --- |
| `GET` | `/health`, `/v1/health` | Public liveness |
| `GET` | `/health/detailed` | Public bounded readiness at audited revision |
| `GET` | `/v1/capabilities` | Feature and endpoint discovery |
| `GET` | `/v1/models` | Advertised model |
| `GET` | `/v1/skills`, `/v1/toolsets` | Agent-visible skills/toolsets |
| `POST` | `/api/sessions` | Create persisted session |
| `GET/PATCH/DELETE` | `/api/sessions/{id}` | Read/update/delete session |
| `GET` | `/api/sessions/{id}/messages` | Read persisted transcript |
| `POST` | `/api/sessions/{id}/fork` | Fork persisted session |
| `POST` | `/api/sessions/{id}/chat` | Synchronous turn |
| `POST` | `/api/sessions/{id}/chat/stream` | Structured SSE turn |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat, optional SSE |
| `POST` | `/v1/responses` | Stateful Responses-style turn |
| `GET/DELETE` | `/v1/responses/{id}` | Read/delete stored response |
| `POST` | `/v1/runs` | Start asynchronous run |
| `GET` | `/v1/runs/{id}` | Poll run status |
| `GET` | `/v1/runs/{id}/events` | Stream run events over SSE |
| `POST` | `/v1/runs/{id}/approval` | Resolve pending approval |
| `POST` | `/v1/runs/{id}/stop` | Cooperatively interrupt a run |
| `GET/POST` | `/api/jobs` | List/create jobs |
| `GET/PATCH/DELETE` | `/api/jobs/{id}` | Read/update/delete job |
| `POST` | `/api/jobs/{id}/pause` | Pause job |
| `POST` | `/api/jobs/{id}/resume` | Resume job |
| `POST` | `/api/jobs/{id}/run` | Run job |
| `POST` | `/api/platforms/{platform}/events` | Platform-signed callback |
| `POST` | `/api/cron/fire` | Conditional Chronos JWT callback |

The adapter also registers job and platform-callback routes. The probe does not
call them. A production Cabinet boundary should use an upstream route allowlist
or a dedicated sidecar mode rather than exposing unrelated management routes.

## Binding, profile, and global-resource isolation

- `PlatformConfig.extra.host` and `.port` control the listener. The probe
  rejects anything except `127.0.0.1:4203`.
- A custom profile path shaped as
  `<isolated-root>/profiles/operator-os` is natively recognized by Hermes as
  `operator-os`; no sticky profile mutation is needed.
- Direct `APIServerAdapter.connect()` owns only its aiohttp listener,
  response store, session database, and in-memory run state. It does not create
  a `GatewayRunner` and does not start dispatcher or webhook ownership.
- Some handlers read gateway-global status/config helpers, and the adapter
  registers callback/job routes, but those imports do not start the gateway.
- Running the normal `hermes gateway` command is not acceptable for this
  probe because it enters the global platform/dispatcher lifecycle.

## Authentication and isolated config

All agent-serving, session, capability, run, approval, stop, and ordinary
management handlers use the configured bearer key. The platform-event callback
uses the target platform's verifier instead, and the conditional Chronos fire
route uses a NAS-minted JWT. `/health` is intentionally public.
At this revision `/health/detailed` is also callable without the bearer check,
despite installed documentation describing it as authenticated. Its response is
bounded status, but this is still a source/documentation mismatch.

The isolated home must contain no `.env` and its `config.yaml` must contain
only these nonsecret fields:

```yaml
model:
  default: "<acceptance model id>"
  provider: "<environment-authenticated provider id>"
  # base_url: "<optional nonsecret endpoint>"
platform_toolsets:
  api_server: []
mcp_servers: {}
```

It must also contain `.cabinet-http-sse-profile` with the exact text
`operator-os`.

A provider credential can be inherited without retrieving or copying it only
when the overseer shell already exports the provider-specific environment
variable that Hermes normally resolves for the configured provider. The probe
does not inspect, print, copy, or persist that value. If no supported
environment-only credential is already exported, live measurement is blocked
by authentication; copying an OAuth file, profile `.env`, or production
credential is outside authorization.

`HERMES_HTTP_SSE_API_KEY` is a new disposable caller-auth token for this local
sidecar, not a model-provider credential.

## Session and SSE findings

- Session resources use Hermes `SessionDB`; the fixture retained four messages
  and resumed the same session after a complete adapter restart.
- Responses state uses an on-disk SQLite response store and
  `previous_response_id`.
- Session chat SSE emits named events with per-turn monotonically increasing
  `seq`, including `run.started`, `message.started`, `assistant.delta`,
  `assistant.completed`, `run.completed`, and `done`.
- Run SSE emits JSON in `data:` frames plus keepalive comments.
- Run status remains pollable after a stream disconnect or transport-buffer
  expiry.
- Run-event SSE does **not** emit `id:` fields, process `Last-Event-ID`, or
  retain a replayable event history. Once its single queue is consumed or
  removed, reconnect cannot recover missed events from SSE; the client must
  reconcile via `GET /v1/runs/{id}`.
- Session-stream disconnect cancels the asyncio wrapper, but this handler does
  not pass an `agent_ref` to `_run_agent`. Unlike Chat Completions SSE and the
  runs stop path, it therefore cannot call `agent.interrupt()` directly; an
  executor-backed model call may outlive a disconnected client.

## No-tools finding

Hermes has no request-level or adapter-level native `no_tools` flag for this
surface. `platform_toolsets.api_server: []` is not independently sufficient:
newly discovered plugin toolsets can be auto-enabled by the platform resolver.

The live probe narrows the resolver to an empty set during `AIAgent`
construction and then fails closed unless both the tool schema and valid tool
name set are empty. Static tests prove the override is restored and the probe
rejects any surviving tool. This is safe for research but is not the preferred
production integration.

Minimum upstream change: add an explicit API-server `no_tools` setting (or
constructor argument) that passes `enabled_toolsets=[]` after all plugin, MCP,
memory, and context-engine injection paths, asserts the final schema is empty,
and advertises the enforced state in `/v1/capabilities`.

## Tests

| Test | Result |
| --- | --- |
| Owned probe tests | `7 passed` |
| Deterministic fixture two-turn token | Passed |
| Same session after adapter restart | Passed |
| Loopback/port guards | Passed |
| Bearer auth rejection | Passed |
| SSE content type, event order, deduplication | Passed |
| Zero fixture tool events | Passed |
| No-tools fail-closed guard | Passed |
| Installed Hermes API/SSE suites | `257 passed, 1 failed` |

The one installed-suite failure was
`TestHealthDetailedEndpoint.test_health_detailed_returns_ok`: under a deliberately
empty isolated home the readiness result was `degraded`, while the test expected
`ok`. The transport, run, SSE, approval, stop, and session tests otherwise
passed. No production profile was used to make that readiness test green.

## Rubric score (pre-live)

| Category | Score |
| --- | ---: |
| Two-turn correctness | 0 / 20 |
| Session durability across Cabinet restart | 12 / 15 |
| Streaming correctness and deduplication | 8 / 10 |
| No-tools enforcement | 7 / 10 |
| Failure/cancellation semantics | 5 / 10 |
| Native Hermes fit | 10 / 10 |
| Future management breadth | 9 / 10 |
| Operational simplicity | 3 / 5 |
| Security boundary | 3 / 5 |
| Maintenance burden | 3 / 5 |
| **Total** | **60 / 100** |

Two-turn correctness remains zero until the authorized real-model measurement
passes. Mandatory result: **blocked**, not passed.

## Exact serialized live command

Do not run this concurrently with another model probe. It assumes the isolated
home and nonsecret config described above already exist and the configured
provider's supported credential variable is already exported:

```bash
HERMES_SOURCE="$HOME/.hermes/hermes-agent" \
HERMES_HTTP_SSE_ACCEPTANCE_HOME="/absolute/isolated-root/profiles/operator-os" \
HERMES_HTTP_SSE_API_KEY="$(openssl rand -hex 32)" \
"$HOME/.hermes/hermes-agent/venv/bin/python" \
experiments/transports/http-sse/probe.py live \
  --host 127.0.0.1 --port 4203 --profile operator-os
```

## Recommendation

Keep this transport in research until the serialized live acceptance passes.
If it passes, prefer an upstream dedicated API-sidecar/no-tools mode with a
conversation-only route allowlist, SSE replay IDs/history, and direct
session-stream interruption before integrating it into Cabinet.

Production Cabinet, canonical Cabinet data, existing Hermes profiles,
credentials, sticky profile state, launchd, gateway jobs, production services,
and port 4000 remained untouched.
