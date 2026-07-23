# Persistent ACP official-SDK transport probe

## Verdict

Status: **LIVE_READY, mandatory acceptance pending**.

The official TypeScript SDK is a materially better client boundary than
Cabinet's handwritten JSON-RPC parser. The isolated implementation keeps one
Hermes ACP process and one ACP connection alive across turns, validates ACP v1
schemas, sends `mcpServers: []`, advertises no client file-system or terminal
capability, rejects every tool or permission event, detects duplicate chunks,
fails closed on malformed frames, and exposes bounded timing and RSS metrics.

The transport is not yet a merge candidate. Two mandatory conditions remain:

1. The authorized real-model two-turn acceptance has intentionally not run.
2. The exact Hermes companion executes configured MCP discovery before it
   begins reading ACP input, even when `HERMES_ACP_NO_TOOLS=1`. An empty
   per-session `mcpServers` list therefore does not prove zero MCP connections
   at process startup. Hermes must make no-tools mode skip startup MCP
   discovery before this transport can satisfy the zero-MCP security boundary.

Provisional score: **71/100**. A mandatory-condition failure or an unsuccessful
live probe disqualifies the transport regardless of score.

## Exact audited inputs

| Input | Exact revision or version | Finding |
| --- | --- | --- |
| Cabinet baseline | `3c3193a44a34dbe7b047ddd256e3d1aec31e1097` | Research branch started from the required baseline. |
| Installed Hermes | `55759cb2737cd3870f9de4693f66fa38eaf0dd2b` | Uses Python `agent-client-protocol==0.9.0`, negotiates ACP protocol version 1, persists ACP sessions, and has no process-owned no-tools switch. |
| Cabinet PR 14 | head `f68f83a1f5ec7d6e85d7c6ed5f7377bef3083dc0`, base `9126cdce3b153aae9754f7aacbb83ebcb0b63197` | Adds a handwritten, per-turn ACP process/parser and persists the ACP session ID between Cabinet turns. |
| ACP companion | `139214139446dd705423589afb0c9ba072e4bafe` based on `fe93fde4fa4a6b8c33b3dabd4795461f0f4490aa` | Adds only a companion entry point and `HERMES_ACP_NO_TOOLS`; the switch removes configured MCP toolsets and the Hermes ACP toolset from `AIAgent`. |
| Official TypeScript SDK | `@agentclientprotocol/sdk@1.3.0`, upstream head inspected at `ce35f1e2728a4863b9d75ae9f9ef0262d7fb5828` | Stable package entry point is ACP v1. Package integrity is locked in the nested lockfile. |

Primary protocol references:

- [ACP v1 initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP v1 session setup and load](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP v1 prompt turns](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP v1 cancellation](https://agentclientprotocol.com/protocol/v1/cancellation)
- [Official TypeScript SDK](https://github.com/agentclientprotocol/typescript-sdk/tree/ce35f1e2728a4863b9d75ae9f9ef0262d7fb5828)

## Contract findings

### Protocol and streaming

- Hermes and both official SDKs negotiate ACP protocol version `1`.
- Hermes emits assistant text through `session/update` notifications and
  returns the terminal stop reason from `session/prompt`.
- The official SDK provides typed method routing and schema validation. A small
  bounded pre-SDK frame guard is still necessary because the SDK's NDJSON
  helper otherwise logs and discards malformed JSON instead of making the
  pending request fail immediately.
- Duplicate detection uses the complete update signature within one turn.
  Repeated identical updates are counted and excluded from assembled output.
- Tool calls, tool updates, permission requests, file requests, and terminal
  capability advertisement are all fail-closed.

### Session lifecycle and restart behavior

- Hermes keeps active session objects in a process-local `SessionManager`.
- It also persists ACP sessions and messages in its session database.
  `session/load` recreates an `AIAgent` from stored provider/model/cwd metadata
  and repaired history, then replays history before responding.
- Process-local state is acceptable only as a hot cache. It is not a durable
  boundary by itself.
- A Cabinet browser reconnect is compatible with a server-owned persistent
  ACP sidecar because the browser does not own the stdio stream.
- A Cabinet application restart can resume only if it reconnects to an
  independently supervised sidecar, or starts a replacement and calls
  `session/load`. A child process owned directly by the Next process would die
  with Cabinet.
- Fixture verification proves session load after ACP-process replacement. The
  real Hermes restart/load check is prepared but remains part of the serialized
  live run.

### Cancellation and failures

- ACP cancellation is a notification, not a request. On timeout the probe sends
  `session/cancel`, then reports a bounded timeout.
- Hermes sets its session cancellation event and invokes the agent interrupt
  hook while holding the session runtime lock.
- Child death rejects the pending SDK request as a transport failure. Restart
  creates a new PID and attempts `session/load`.
- Invalid or oversized frames are classified as protocol failures without
  retaining or reporting raw frame contents.

### No-tools and MCP boundary

- The exact installed Hermes revision ignores `HERMES_ACP_NO_TOOLS`.
- The companion revision correctly creates `AIAgent` with no enabled toolsets
  and no configured MCP server toolsets when the switch is enabled.
- However, `acp_adapter.entry` calls `discover_mcp_tools()` unconditionally
  before starting the ACP event loop. This may initialize globally configured
  MCP servers even though the later session has no tools and receives
  `mcpServers: []`.
- A source-compatible isolated-home initialization completed through the
  official TypeScript SDK with protocol v1, `loadSession: true`, and zero parse
  errors. A configured-profile initialization did not complete within the
  bounded 10-second source-only check. The unconditional startup work is the
  material difference; no model call was made. That configured-profile check
  reached Hermes' existing startup path before it was terminated, so it loaded
  the already-configured external secret source into the disposable child and
  may have attempted configured MCP connectivity. No credential value was
  printed, retained by the probe, changed, or committed, and no session or
  model request was made.

## Current invalid-protocol response

The exact production error cannot be attributed to one frame from available
evidence. PR 14 maps malformed JSON, invalid response shapes, any JSON-RPC error
response, and several unexpected lifecycle results into the same generic
message. Its fixture tests do not exercise the exact Hermes process.

The official SDK removes the handwritten method/result routing and validates
the exact v1 schema, so it fixes that client-side ambiguity and passed isolated
Hermes initialization. It does **not** fix server-side startup blocking,
configured MCP discovery, companion drift, or no-tools enforcement in the
installed Hermes revision. A serialized live measurement is required before
claiming that it fixes the observed production failure.

## Provisional transport rubric

| Category | Score | Reason |
| --- | ---: | --- |
| Two-turn correctness | 10/20 | Exact fixture passes; authorized model run pending. |
| Session durability across Cabinet restart | 15/15 | Persistent sidecar survives browser/Cabinet client reconnect; persisted `session/load` supports replacement. |
| Streaming correctness and deduplication | 10/10 | Typed notifications, ordered single-turn queue, duplicate detection, malformed-frame guard. |
| No-tools enforcement | 5/10 | Client and companion fail closed, but startup MCP discovery violates the complete boundary. |
| Failure and cancellation semantics | 10/10 | Timeout/cancel, malformed frame, tool event, death, and restart are covered. |
| Native Hermes fit | 10/10 | Uses Hermes' native ACP v1 server and durable session ID. |
| Future management breadth | 2/10 | Primarily conversation lifecycle; not a broad Hermes management plane. |
| Operational simplicity | 2/5 | One durable child is simple after startup, but supervision and startup discovery remain. |
| Security boundary | 3/5 | Safe capabilities and environment; global startup discovery remains. |
| Maintenance burden | 4/5 | Official pinned SDK reduces custom protocol code; bounded frame guard and sidecar supervision remain. |
| **Total** | **71/100** | **Provisional and not eligible to win until mandatory checks pass.** |

## Tests

- Nested TypeScript build: passed.
- Node fixture suite: 8 passed, 0 failed.
- Standalone exact two-turn fixture acceptance: passed with one session, one
  process, exact token twice, zero tools, zero duplicate events, and zero parse
  errors.
- Isolated-home official-SDK initialization against the exact companion source:
  passed with ACP v1 and `loadSession: true`.
- Authorized real-model acceptance: not run.

The fixture suite covers persistent two-turn reuse, logical browser reconnect,
duplicate chunks, forbidden tools, malformed frames, cancellation, process
death, and persisted load after process restart.

## Required live command

The overseer should serialize this after the other transport probes report
ready:

```sh
cd <acp-sdk-worktree>/experiments/transports/acp-sdk
HERMES_ACP_COMMAND=<hermes-home>/hermes-agent-acp-pr14/cabinet-hermes-companion \
HERMES_ACP_ARGS_JSON='["-p","operator-os","acp"]' \
HERMES_ACP_CWD=<acp-sdk-worktree>/experiments/transports/acp-sdk/live-workspace \
npm run live -- --authorized-live
```

This sends exactly the two authorized messages in one session and process,
then restarts the process and performs a no-model `session/load`. Before running
it, the overseer should resolve the unconditional startup MCP-discovery blocker
or explicitly record that the mandatory zero-MCP condition cannot pass.

## Recommendation

Retain the official-SDK persistent sidecar as the ACP candidate, but do not
integrate it yet. First make the Hermes no-tools boundary suppress all startup
MCP discovery, then run the serialized two-turn and restart/load acceptance.
If both pass, prefer this design over the per-turn handwritten parser.

The minimum upstream companion patch is an environment guard around the
existing discovery call in `acp_adapter/entry.py`:

```diff
-    try:
-        from tools.mcp_tool import discover_mcp_tools
-        discover_mcp_tools()
-    except Exception:
-        logger.debug("MCP tool discovery failed at ACP startup", exc_info=True)
+    no_tools = os.environ.get("HERMES_ACP_NO_TOOLS", "").strip().lower() in {
+        "1", "true", "yes", "on",
+    }
+    if not no_tools:
+        try:
+            from tools.mcp_tool import discover_mcp_tools
+            discover_mcp_tools()
+        except Exception:
+            logger.debug("MCP tool discovery failed at ACP startup", exc_info=True)
```

This is the smallest patch that aligns startup behavior with the companion's
existing process-owned no-tools session construction. Its upstream tests must
assert that `discover_mcp_tools()` is never called for every accepted true
spelling and is still called in normal ACP mode.

Production Cabinet, canonical Cabinet data, environment files, services,
launchd, port 4000, and network listeners were not modified. No live model
message was sent.
