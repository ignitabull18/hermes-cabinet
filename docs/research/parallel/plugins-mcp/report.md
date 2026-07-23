# Hermes plugins and MCP management contract audit

Date: 2026-07-23
Stream: `plugins-mcp`
Branch: `research/hermes-plugins-mcp-management`
Cabinet base: `3c3193a44a34dbe7b047ddd256e3d1aec31e1097`
Audited Hermes revision: `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`

## Verdict

Hermes has native CLI and authenticated Dashboard operations for most requested
plugin and MCP actions. Those operations are useful operator primitives, but
they are not yet a safe Cabinet control plane.

Cabinet should consume the read surfaces now only as sanitized projections. It
should not wire live plugin or MCP mutations until Hermes adds stable canonical
identifiers, complete redacted readbacks, target revisions, compare-and-swap
preconditions, structured restart impact, post-action canonical receipts, and
rollback/revoke contracts.

The accompanying prototype is intentionally preview-only. It fingerprints an
exact Hermes snapshot, requires content/tool allowlists, rejects stale state,
requires a second canonical read immediately before a mutation, and reconciles
ambiguous results as `outcome_unknown` with automatic retry disabled. It has no
executor.

No live plugin, MCP server, credential, profile, configuration, service, or
runtime was changed during this audit.

## Primary sources and method

The installed checkout and its `origin/main` both resolved to
`55759cb2737cd3870f9de4693f66fa38eaf0dd2b`. The checkout contained an unrelated
untracked `.headroom/` directory before this audit; it was not read or modified.

Installed-source references below are immutable permalinks into the official
NousResearch repository:

- [plugin CLI parser](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/subcommands/plugins.py)
- [plugin mutation and discovery implementation](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/plugins_cmd.py)
- [plugin runtime loader](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/plugins.py)
- [MCP CLI parser](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/subcommands/mcp.py)
- [MCP configuration operations](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/mcp_config.py)
- [MCP catalog implementation](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/mcp_catalog.py)
- [Dashboard HTTP contracts](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/web_server.py)
- [MCP runtime and tool registration](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/tools/mcp_tool.py)
- [MCP configuration screening](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/mcp_security.py)
- [per-platform tool exposure](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/tools_config.py)
- [TUI Gateway plugin/status contracts](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/tui_gateway/server.py)

Protocol conclusions were checked against the official
[MCP 2025-11-25 tool contract](https://modelcontextprotocol.io/specification/2025-11-25/server/tools),
[authorization contract](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization),
[security best practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices),
[lifecycle contract](https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle),
and [official Registry versioning rules](https://modelcontextprotocol.io/registry/versioning).
The Registry is preview and is not used by Hermes' built-in Nous catalog.

This was a source audit only. No Dashboard credential was retrieved, no live API
was called, no CLI management action was run, and no fixture server was needed.

## Supported operations

### Plugins

| Operation | Native contract | Machine-readable result | Scope and effect | Cabinet assessment |
|---|---|---|---|---|
| List | `hermes plugins list --json`; `GET /api/dashboard/plugins/hub`; TUI Gateway `plugins.manage {action:"list"}` | CLI JSON rows contain `name`, `status`, `version`, `description`, `source`. Hub adds dashboard metadata, local path, update/remove flags, and an auth command hint. | Dashboard/TUI operate on the process profile. There is no arbitrary-profile parameter. | Projection is usable only after stripping path, command hints, and content-bearing descriptions. It is not a complete runtime inventory when project plugins are enabled. |
| Install | `hermes plugins install`; `POST /api/dashboard/agent-plugins/install` | HTTP returns `ok`, plugin name, warnings, missing env names, and enabled state. | Clones into the process profile's plugin directory; optional enable writes config. CLI says restart the gateway. | Native operation exists, but there is no immutable target revision, content digest, signature, dry run, rollback receipt, or stale-state guard. |
| Update | `hermes plugins update`; `POST /api/dashboard/agent-plugins/{name}/update` | HTTP returns `ok`, `name`, raw git output, and `unchanged`. | User git checkouts only. Runs `git pull --ff-only` in place. | Unsupported for governed use. The target is floating and the result has no before/after commit identity. Raw git output also needs privacy scrubbing. |
| Enable | `hermes plugins enable`; authenticated HTTP enable route; TUI toggle | HTTP/TUI return `ok`, name, and `unchanged`; TUI also returns a refreshed row. | Writes `plugins.enabled`/`disabled`; Dashboard also changes plugin toolsets across configured platforms. Effective on a new session/process. | Primitive exists, but current hub rows omit the canonical loader key and exposed-tool inventory. No compare-and-swap or restart receipt exists. |
| Disable | `hermes plugins disable`; authenticated HTTP disable route; TUI toggle | Same basic response as enable. | Writes config; does not unload already imported code from a running process. | Can become a governed compensating action after exact identity and runtime-scope contracts exist. |
| Remove | `hermes plugins remove`; authenticated HTTP delete route | HTTP returns `ok` and name. | User plugin trees only; bundled plugins cannot be removed. | Unsupported for governed use. Removal does not clear enabled/disabled aliases, tool-override grants, platform toolset references, credentials, or external effects. |

`GET /api/dashboard/plugins` is public by deliberate Dashboard design, but it is
only the active Dashboard-extension manifest feed. It is not the management
inventory and must never be used as the canonical readback.

### MCP

| Operation | Native contract | Machine-readable result | Scope and effect | Cabinet assessment |
|---|---|---|---|---|
| List | `hermes mcp list`; `GET /api/mcp/servers?profile=` | HTTP returns redacted summaries: name, transport, URL or command/args, redacted env, auth type, enabled, and configured tool filter. | Profile-scoped via query/body. | Useful projection, not a full canonical fingerprint. It omits headers, OAuth client details, timeouts, lifecycle, sampling, and other raw fields. |
| Add/configure | `hermes mcp add`; `POST /api/mcp/servers`; whole-map `PUT /api/mcp/servers`; interactive `hermes mcp configure` | Add returns one redacted summary. Replace returns `{ok:true}`. | Profile-scoped config write. Add rejects an existing name with `409`. | Native primitives exist. Whole-map replace is unsafe from the partial list projection and neither path accepts an expected state/version. |
| Enable/disable | `PUT /api/mcp/servers/{name}/enabled` | `{ok,name,enabled}` | Profile-scoped flag; effective on a new session/gateway unless a separate reload occurs. | Governable only after exact pre/post fingerprints and affected-runtime inventory exist. |
| Remove | CLI remove; `DELETE /api/mcp/servers/{name}` | `{ok:true}` | Profile-scoped config delete. | HTTP removal does not invoke the OAuth manager cleanup used by CLI removal. It also does not remove profile env values or bootstrapped install trees. |
| Test/status | CLI test; `POST /api/mcp/servers/{name}/test`; TUI session info | Test returns `ok`, tool names/descriptions, prompt/resource counts, or error. TUI status reports configured/connecting/connected/failed/disabled and tool count for its process. | Test actively starts/connects a server. TUI status is process-local, not durable state. | Treat test as high risk: stdio can execute arbitrary local code and returned descriptions are untrusted content. No single HTTP read combines canonical config with live status. |
| Authenticate | CLI login/reauth; `POST /api/mcp/servers/{name}/auth`; flow status and callback endpoints | Flow snapshots expose state; callback is state-bound. | Profile-scoped. Same-process profile can request a live reconnect after success. | OAuth initiation exists, but scope inventory is not exposed as a stable preflight and there is no revoke endpoint. Header/API-key state has no positive verification contract. |
| Catalog | CLI catalog/install; `GET /api/mcp/catalog`; `POST /api/mcp/catalog/install` | Catalog returns source, exact command/args/URL, auth/env names, git URL/ref, bootstrap commands, default tools, post-install text, and installed/enabled state. | Nous-curated repo-shipped catalog. Some installs run in a background action. | This is the strongest preview source, but install is still code execution. Git installs run shell bootstrap commands. It is not the official MCP Registry. |

## Authentication and credential boundary

All non-public Dashboard API routes are protected by one of two server-side
schemes:

1. loopback mode uses an ephemeral Dashboard session token sent as
   `X-Hermes-Session-Token` or legacy Bearer auth;
2. non-loopback mode uses a verified Dashboard session cookie.

Cabinet must keep either credential server-side and must not surface it in the
browser, logs, reports, action envelopes, or fingerprints. Middleware enforces
the protection, but the generated operation schemas do not encode the complete
auth and concurrency contract. A client generated from OpenAPI alone would not
understand the real boundary.

MCP bearer inputs are one-time provisioning values. Hermes stores the value in
the selected profile's `.env` and writes an interpolation template into
`config.yaml`. List responses redact stdio env values and do not return headers.
OAuth token files are managed separately. Therefore:

- secret values cannot participate in Cabinet-side hashes;
- a credential-presence marker must come from Hermes;
- rollback cannot be reconstructed from `GET /api/mcp/servers`;
- removal/revocation must be separate explicit operations;
- Cabinet must never fetch or mirror token files.

Plugin `requires_env` has only a missing-name projection in the Dashboard
install response. There is no complete per-plugin credential status or revoke
contract.

## Provenance, trust, and content-bearing risk

### Plugin risks

Hermes plugins are executable Python and may register tools, lifecycle hooks,
middleware, platform adapters, CLI/slash commands, skills, Dashboard JavaScript
and CSS, and Dashboard backend API routes. Hooks can inspect or transform
prompts, tool calls, tool results, and model output. A privileged
`allow_tool_override` grant lets a plugin replace built-in tools.

The runtime distinguishes bundled, user, project, and Python entry-point
sources, with later sources able to override earlier names. However:

- Git install accepts floating repositories and performs a depth-one clone;
- `http://` and `file://` sources are warned about, not rejected;
- no signature, maintainer identity, SBOM, content digest, or immutable commit
  is recorded in the management row;
- a missing manifest/entrypoint is warned about after installation rather than
  rejected;
- `after-install.md`, manifest descriptions, Dashboard manifests, and remote
  git output are content-bearing;
- the hub emits an absolute local plugin path and shell-shaped auth hint;
- project plugins are loaded by the runtime when opted in, but
  `_discover_all_plugins()` does not actually add the project directory even
  though its docstring claims it does;
- hub rows return manifest `name` but not the path-derived canonical `key`;
- same-name or alias collisions can therefore make an HTTP action broader or
  more ambiguous than a governed wrapper can safely accept;
- Dashboard enable does not expose the CLI's explicit built-in-tool override
  consent flow, while previously persisted grants can survive removal.

Cabinet must treat every non-bundled plugin as untrusted executable content.
"Bundled" means shipped with the audited Hermes revision, not universally safe
or immutable across updates.

### MCP risks

MCP stdio configuration is local code execution with Hermes' operating-system
privileges. Hermes' save-time and spawn-time scanner blocks a narrow set of
known shell-plus-egress, persistence, and campaign-IOC shapes. It explicitly
does not sandbox or command-allowlist MCP servers.

The official MCP security guidance requires exact, untruncated command display,
explicit consent, and recommends sandboxing/restricted privileges for one-click
local servers. A Cabinet preview must therefore display and fingerprint the
exact command, arguments, working/install source, bootstrap commands, network
scope, and profile before any stdio action.

Remote MCP OAuth adds metadata-discovery SSRF, redirect, token-audience, token
storage, and confused-deputy risks. Cabinet should defer OAuth execution to
Hermes, but require Hermes to return the exact resource, authorization server,
redirect URI, requested scopes, and credential-presence state before approval.
Cabinet must never proxy or pass through tokens.

Tool descriptions, prompt templates, resources, and tool results are untrusted
content. Hermes scans suspicious tool descriptions but only logs a warning; it
does not block them. Its registry conversion preserves name, description, and
input schema but drops MCP tool annotations and output schema. The MCP spec says
annotations are untrusted hints even when preserved, so Cabinet needs its own
trusted policy classification rather than relying on `readOnlyHint` or
`destructiveHint`.

Per-server `tools.include` is an allowlist and takes precedence over
`tools.exclude`. With no filter, all present and future server tools are
registered. Globally enabled MCP servers are exposed on every platform by
default unless a platform explicitly allowlists server names or uses `no_mcp`.
Servers may also emit `notifications/tools/list_changed`, causing the runtime
tool surface to refresh. A previously approved fingerprint must become stale
whenever the discovered tool set changes.

## Canonical readback, restart, and rollback

### Canonical readback

No existing response is sufficient as a universal postcondition:

- plugin hub lacks canonical key, git remote/revision, content digest,
  registered tools/hooks, tool-override grant, project-plugin completeness, and
  loaded-process identity;
- MCP list is a redacted partial projection and cannot safely seed whole-map
  replacement;
- MCP test is a temporary probe, not the status of every running session;
- TUI session info is live but process-local;
- mutation responses carry no canonical state version or action receipt.

The minimum governed sequence is:

1. read exact profile-scoped canonical state from Hermes;
2. sanitize content and secret-bearing fields;
3. compute and present a fingerprint plus exact diff;
4. obtain the required confirmation;
5. reread and compare the fingerprint immediately before execution;
6. execute once with an idempotency key and expected fingerprint;
7. reread canonical config and affected runtime/tool state;
8. return `verified_applied`, `verified_not_applied`, or `outcome_unknown`;
9. never retry `outcome_unknown` automatically.

Hermes does not currently accept the expected fingerprint or idempotency key,
so step 6 remains blocked.

### Restart behavior

- Plugin install explicitly instructs the operator to restart the gateway.
- Plugin enable/disable says the change takes effect on the next session.
- MCP add/configure says to start a new session.
- MCP config changes can auto-reload in the classic interactive CLI, but reload
  rebuilds the tool surface and invalidates the model prompt cache.
- TUI Gateway has revision-aware `reload.mcp`, but that is a separate action
  with its own confirmation and process scope.
- Dashboard MCP enable/disable returns no restart or reload receipt.
- Dashboard OAuth requests a same-process reconnect only when the selected
  profile is the Dashboard process profile.

Cabinet must show restart scope as an explicit effect, not infer success from a
config write. Multi-profile runtimes require an affected-process inventory.

### Rollback

Native rollback is incomplete:

- plugin update has no prior commit capture or reset operation;
- plugin removal has no archive/restore and leaves config/grants/credentials;
- MCP whole-map rollback requires raw prior fields absent from list readback;
- MCP HTTP removal leaves OAuth cleanup different from CLI behavior;
- catalog install may write env values before a later clone/bootstrap failure;
- catalog bootstrap can have arbitrary external side effects;
- OAuth has reauthentication but no governed revoke.

Enable/disable toggles are compensating actions, not true rollback. They cannot
undo effects produced while tools or hooks were active.

## Prototype

Files:

- `experiments/management/plugins-mcp/governed-actions.mjs`
- `experiments/management/plugins-mcp/governed-actions.test.mjs`
- `experiments/management/plugins-mcp/README.md`

The prototype provides:

- deterministic SHA-256 fingerprints over a secret-safe Hermes snapshot;
- exact profile and authority checks;
- stale-state rejection;
- content digest and exact tool allowlist requirements;
- immutable revision requirements for plugin install;
- explicit consent for stdio execution;
- blocking of native unpinned plugin update;
- blocking of MCP whole-map replacement from a partial projection;
- typed confirmation for built-in tool override;
- rollback feasibility/residual-effect metadata;
- canonical reread authorization that returns no mutation instruction;
- post-action reconciliation with `outcome_unknown` and no automatic retry.

It deliberately does not provide an HTTP client, CLI invocation, credential
reader, config writer, process restart, or executor.

## Upstream gaps

Recommended Hermes additions, in priority order:

1. `GET /api/management/plugins` with canonical key, source class, remote URL,
   immutable revision/package version, manifest/content digest, trust basis,
   declared and actually registered capabilities, override grants, loaded
   process IDs/generations, profile, and a canonical state version. Include
   project and entry-point plugins or explicitly report them as unmanaged.
2. Plugin preview endpoints that resolve a requested source and target revision
   without installing, return a content manifest/diff, reject floating refs for
   governed callers, and expose signature/attestation data when available.
3. Plugin mutations accepting `expected_state_version`, `idempotency_key`, exact
   target revision, requested capability grants, and explicit restart mode.
   Return a canonical receipt and a rollback artifact/operation.
4. Normalize every plugin route on one canonical key. Reject ambiguous manifest
   name/leaf aliases. Remove stale enabled/disabled aliases, toolset references,
   override grants, and credential metadata transactionally.
5. `GET /api/management/mcp/servers` with a stable redacted canonical digest,
   credential-presence/auth-health markers, complete non-secret config, exact
   tool allowlist, discovered tool digest, negotiated protocol/server version,
   capability inventory, live status by process/profile, and last error code
   without raw sensitive messages.
6. Per-server MCP patch endpoints with expected version. Avoid whole-map replace
   for normal edits. Return affected runtimes and whether reload/restart is
   required.
7. MCP install preview that validates official Registry or Nous-catalog
   metadata, pins package/commit versions, hashes bootstrap content, shows exact
   untruncated commands, and performs no credential write before approval.
8. Unified MCP remove/revoke/purge semantics for config, OAuth manager/token
   state, `.env` references, and bootstrapped trees, each separately selectable
   and previewable.
9. Preserve MCP tool output schema and annotations as untrusted metadata, add a
   trusted host policy classification, and expose content-source/taint signals.
10. Emit tool-surface change generations for plugin load/unload and MCP
    `list_changed`, so Cabinet can invalidate approvals and projections
    deterministically.
11. Encode Dashboard auth requirements and structured error schemas in the
    published API contract, without exposing the ephemeral credential.
12. Add first-class mutation receipts with `verified_applied`,
    `verified_not_applied`, and `outcome_unknown`, plus an idempotency lookup
    endpoint.

## Recommendation

Merge this research artifact only as a non-production reference. Cabinet may
project sanitized plugin/MCP inventory, but live mutation wiring should remain
disabled. The next implementation step belongs upstream in Hermes: ship
canonical, versioned management readbacks and expected-version/idempotent
mutation contracts, then bind Cabinet's preview envelope to those contracts.
