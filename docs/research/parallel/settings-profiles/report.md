# Hermes settings and profiles management contract audit

Date: 2026-07-23
Stream: `settings-profiles`
Status: Passed (prototype only; production wiring intentionally excluded)

## Executive finding

Hermes has usable native settings and profile primitives, but it does not have a
safe remote governance transaction contract.

The installed source at revision
`55759cb2737cd3870f9de4693f66fa38eaf0dd2b` exposes:

- profile-scoped machine reads through the Management/Dashboard API;
- profile create, rename, delete, sticky selection, and config mutation;
- a broad CLI for profile and config management;
- Desktop-only persistence that selects a Desktop primary profile and relaunches
  its primary backend.

It does **not** expose revision/ETag preconditions, idempotency keys, typed
confirmation, mutation receipts, atomic multi-step profile creation, or a
canonical rollback operation. Cabinet therefore must place a durable governance
layer in front of Hermes, perform exactly one native dispatch, and decide the
outcome from a canonical reread. It must never retry a timed-out mutation.

No live profile values, active-profile value, services, credentials, or
environment values were read. No Hermes, Cabinet, profile, service, or
production mutation was performed.

## Primary sources

The audit used only official and exact source:

- installed `NousResearch/hermes-agent` checkout at `55759cb...`;
- official upstream `main` HEAD observed as `01b0451909eaada46c455387706ddf21ca1e113c`;
- installed `hermes_cli/profiles.py`,
  `hermes_cli/subcommands/profile.py`, `hermes_cli/config.py`,
  `hermes_cli/subcommands/config.py`, and `hermes_cli/web_server.py`;
- installed Desktop `apps/desktop/src/hermes.ts`,
  `apps/desktop/src/store/profile.ts`, and
  `apps/desktop/electron/main.ts`;
- official [Profiles guide](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/website/docs/user-guide/profiles.md);
- official [Web Dashboard guide](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/website/docs/user-guide/features/web-dashboard.md);
- official current
  [profile CLI parser](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/hermes_cli/subcommands/profile.py).

The current upstream profile command family and Management endpoint family
remain materially the same for this audit. Upstream additionally documents the
Dashboard as a machine-level, multi-profile management surface and explicitly
states that config changes take effect on a new agent session or gateway
restart.

## Native contract inventory

### Machine-readable reads

| Concern | Native contract | Shape and limitations |
|---|---|---|
| Profile inventory | `GET /api/profiles` | JSON profile summaries. Includes path and coarse metadata; Cabinet should drop paths and `has_env` before returning data to a browser. The list may probe gateway/service state. |
| Sticky vs current profile | `GET /api/profiles/active` | JSON `{active,current}`. `active` is the sticky default for future invocations; `current` is the profile of the running Management process. They are intentionally different concepts. |
| Effective config projection | `GET /api/config?profile=<id>` | JSON, normalized for the web surface, with internal underscore-prefixed keys removed. |
| Config defaults | `GET /api/config/defaults` | JSON default tree. Not a profile-specific stored-state revision. |
| Typed field catalog | `GET /api/config/schema?profile=<id>` | JSON schema-like field map and category order. Provider options are discovered per request. It is not a full JSON Schema and carries no compatibility version. |
| Raw config | `GET /api/config/raw?profile=<id>` | Raw YAML plus resolved path. The path must not be projected to a Cabinet browser. Raw YAML is a Developer-only source for server-side hashing/backup, not an operator editor. |
| CLI config read | `hermes -p <id> config get <key> --json` | Machine-readable for one key. `profile list/show` remain human-formatted, so the API is the better native read boundary. |

The read contract has no `revision`, `updated_at`, `ETag`,
`Last-Modified`, or file identity field. Cabinet must derive a content revision
from a secret-free canonical projection, while retaining an opaque server-side
hash of the complete raw document if exact write-conflict detection is needed.

### Native mutations

| Capability | CLI | Management API | Native behavior | Cabinet governance |
|---|---|---|---|---|
| Typed settings update | `hermes -p <id> config set/unset` | `PUT /api/config?profile=<id>` with `{config}` | API deep-merges incoming config into disk state and writes atomically, but has no compare-and-swap. CLI accepts forced unknown keys and can write before warning. | Allowlisted schema fields only; base revision required; fresh reread before dispatch. |
| Raw settings replacement | Config editor / direct file | `PUT /api/config/raw?profile=<id>` with `{yaml_text}` | Full document replacement after YAML mapping validation. | Developer-only and initially unsupported. Never send raw config through the browser. |
| Create profile | `profile create` with clone flags | `POST /api/profiles` | Creates the directory, may seed skills and alias, then applies some optional additions best-effort; Hub installs may continue asynchronously. Container creation may register an s6 service slot. | First release: blank/no-secret creation only. Treat partial success as possible and verify every projected field. |
| Rename profile | `profile rename <old> <new>` | `PATCH /api/profiles/<old>` | Stops a running gateway, changes the directory, alias, sticky profile reference, and some profile metadata. | Consequential; require gateway/service impact preview. Verify old absent/new present and sticky/current semantics. |
| Select sticky profile | `profile use <id>` | `POST /api/profiles/active` | Atomically writes/removes the sticky `active_profile` marker. It does not retarget the already-running Dashboard process. | Call it “default for future runs,” never “switch current runtime.” |
| Delete profile | `profile delete <id>` | `DELETE /api/profiles/<id>` | CLI asks the user to type the profile id. API bypasses that prompt (`yes=True`). Stops profile-bound backends, removes service/alias, deletes the directory, and resets sticky active to default if necessary. Default cannot be deleted. | Block until an opaque, restorable pre-delete snapshot exists. Require exact phrase and no current profile-bound process. |
| Profile description/model/SOUL | Dedicated profile routes | Dedicated routes | Separate single-purpose writes with no shared transaction. | Treat as separate governed changes, never hidden post-create steps. |
| Import/export/distribution | CLI only | Not exposed as a general profile API | Export excludes `.env` and `auth.json`; import creates a new named profile. Distribution update is not inheritance. | Future phase after a native opaque snapshot/restore receipt contract. |

## Profile inheritance finding

Hermes has no live parent/child profile inheritance contract.

- `--clone` is a point-in-time copy of config, `.env`, SOUL, selected memory
  identity files, and skills.
- `--clone-all` is a broader point-in-time copy with explicit infrastructure,
  runtime, and history exclusions.
- profile distributions can update distribution-owned files while preserving
  user-owned data, but do not make the installed profile inherit effective
  config from a parent.
- each profile has an independent `HERMES_HOME`.

Cabinet must label these operations **Copy from** or **Install distribution**,
not **Inherit from**. A true inheritance feature requires upstream support for
an explicit parent reference, effective-config resolution, cycle detection,
field provenance, and parent-revision invalidation.

## Profile-specific services and restart contract

Profiles have separate gateway state and potentially separate service units.
Creation, rename, and deletion are not filesystem-only operations:

- container profile creation can register an s6 gateway service slot;
- host gateway services are installed and managed independently;
- rename and delete can stop gateways and remove service definitions;
- delete also finds and stops other profile-bound Dashboard/Desktop backends;
- multiple profiles can contend for ports or messaging dispatcher ownership.

Restart expectations:

| Change | Minimum effect boundary |
|---|---|
| Ordinary agent/session config | New agent session. Existing sessions may retain prior prompt/config state. |
| Gateway-consumed config | Explicit restart of the target profile gateway, after compatibility validation. |
| Sticky profile selection | Future CLI/gateway invocations only. The running Management process remains on `current`. |
| Desktop profile selection | Desktop-only preference write, teardown of the primary backend, and window reload. This is not the durable cross-client management boundary. |
| Rename/delete | Target gateway/service/backend teardown may occur inside the mutation. Cabinet must preview this downtime and never perform a separate preemptive restart. |

The first Cabinet implementation should never restart automatically. A verified
config write returns `restart_required` plus exact scope. Restart is a separate
governed operation owned by the gateway-management stream.

## Desktop-only contracts

Desktop's `window.hermesDesktop.profile.set(name)` is not equivalent to
`POST /api/profiles/active`.

Desktop stores a local preference in its own Desktop config, tears down its
primary backend, and reloads the renderer so that backend starts under the
selected profile. That state is local to Desktop and is not a durable native
management protocol suitable for Cabinet.

Cabinet should use the authenticated Management API for canonical Hermes state.
It may display Desktop selection only as a diagnostic if Hermes later exposes
it through a non-secret, authenticated native contract.

## Required Cabinet governance envelopes

### Read envelope

```json
{
  "contractVersion": 1,
  "source": "hermes-native-management",
  "installedRevision": "<40-char-sha>",
  "profiles": [
    {
      "name": "worker",
      "isDefault": false,
      "settings": {"terminal.backend": "local"},
      "service": {"gatewayRunning": false, "restartRequired": false}
    }
  ],
  "active": {"sticky": "default", "current": "default"},
  "revision": "<sha256-of-secret-free-canonical-state>"
}
```

Paths, env presence, raw YAML, credentials, and secret-bearing values are
server-only or omitted.

### Prepare envelope

Prepare requires:

- intended operation and exact target;
- a `baseRevision` from the canonical read;
- a current installed Hermes source revision;
- allowlisted typed settings;
- exact before/after canonical revisions and changed paths;
- service/restart impact;
- an operation digest and exact typed confirmation;
- a non-automatic rollback plan.

Example phrase:

```text
APPLY HERMES SETTINGS.PATCH worker 9d38c34f71ba
```

The digest binds the phrase to the base revision, target, operation, and
expected revision. No secret or setting value appears in the phrase.

### Dispatch and reread envelope

1. Persist a `prepared` record with a unique dispatch key.
2. Immediately before dispatch, acquire a machine-wide profile-management lock
   and reread canonical state.
3. Reject if the base revision or installed Hermes revision changed.
4. Mark the record `dispatched` durably **before** the native call.
5. Perform exactly one native call.
6. Regardless of HTTP success, timeout, disconnect, or process restart, perform
   canonical reread.
7. Classify:
   - `verified`: canonical revision equals expected revision;
   - `not_applied`: canonical revision still equals base revision;
   - `diverged`: canonical revision is neither;
   - `outcome_unknown`: reread is unavailable.
8. Never retry the native mutation. A new attempt requires a new prepare.

The local prototype demonstrates this logic with an in-memory ledger. Production
must persist the ledger before dispatch so a Cabinet restart cannot lose the
“already dispatched” fact.

## Concurrency and stale-state requirements

Hermes performs atomic file replacement for config writes, but atomic
replacement is not optimistic concurrency control. Two valid writers can read
the same state and the later writer can silently win or deep-merge against an
unexpected version.

Required guards:

1. one machine-wide lock for profile topology changes;
2. one profile-scoped lock for settings changes, ordered under the topology
   lock when both are needed;
3. a fresh raw-config server-side hash and secret-free canonical revision at
   prepare and immediately pre-dispatch;
4. installed Hermes source revision binding;
5. no lock held across human confirmation;
6. expired preparations after a short TTL;
7. durable dispatch receipts and boot-time reconciliation of
   `prepared`/`dispatched` records;
8. a topology generation increment on create/rename/delete/select;
9. no concurrent profile create/delete/rename with a gateway lifecycle action
   for the same profile;
10. no mutation when `active.current` is the deletion target.

Hermes' context-local profile override prevents some in-process request
cross-contamination, but it does not solve cross-process or cross-client
concurrency.

## Rollback matrix

| Operation | Rollback plan | Automatic? | Blocking gap |
|---|---|---|---|
| Typed settings patch | Fresh read, prepare inverse patch from exact server-side before image, confirm, dispatch once, reread. | No | Need an upstream revision/precondition to make exact rollback race-safe. |
| Sticky select | Fresh read and governed select of the prior sticky profile. | No | Running processes were never switched, so do not restart them implicitly. |
| Create | Governed delete only if the newly created profile is still at the verified post-create revision and has no new state. | No | Native create can partially succeed and seed asynchronous work. |
| Rename | Governed inverse rename only after proving the destination has not changed and the old id is still absent. | No | Service/alias restoration and downtime are not represented in a receipt. |
| Delete | Restore from an opaque Hermes-owned pre-delete snapshot into a new profile, then separately restore services. | No | Current API has no opaque snapshot/restore receipt or transactional delete. Profile export excludes credentials by design and is not a complete runtime rollback. |

## Upstream additions required

Recommended upstream Management additions:

1. `revision`/`ETag` on profile inventory, active state, and config reads;
2. `If-Match` or explicit `expected_revision` on every mutation;
3. native `Idempotency-Key` support and durable mutation receipts;
4. a prepare endpoint returning normalized diff, restart scope, and blockers;
5. a single atomic profile-create contract with no best-effort post-create
   sub-operations;
6. a dry-run for rename/delete reporting services, processes, aliases, ports,
   sessions, schedules, and dispatcher conflicts;
7. opaque snapshot/restore handles that never return secret values to Cabinet;
8. explicit restart-requirement metadata per config field;
9. a config schema version and field-level sensitivity/provenance;
10. an authenticated, machine-readable CLI JSON mode for profile inventory;
11. a real inheritance model only if upstream chooses to support it;
12. profile lifecycle events so projections can invalidate immediately.

## Recommended implementation sequence

1. **Read-only projection:** sanitized profile inventory, sticky/current
   distinction, typed safe settings, schema version, and honest freshness.
2. **Governance substrate:** persistent preparations/receipts, locks, revision
   hashing, TTL, boot reconciliation, and canonical reread.
3. **Low-blast-radius typed settings:** allowlisted fields that require only a
   new session; no raw editor and no secrets.
4. **Sticky default selection:** explicitly future-invocation semantics.
5. **Blank profile creation:** no clone, secrets, skills, MCP, messaging, or
   services in the same request.
6. **Rename:** only after service and Desktop-backend impact can be previewed.
7. **Delete:** only after upstream opaque snapshot/restore and dry-run support.
8. **Clone/import/distribution/inheritance:** separate future designs; do not
   overload profile creation.

## Prototype result

Files:

- `experiments/management/settings-profiles/contract.mjs`
- `experiments/management/settings-profiles/contract.test.mjs`
- `experiments/management/settings-profiles/README.md`

The dependency-free prototype covers sanitized deterministic reads, stale-state
prepare rejection, exact changed paths, typed confirmation, native dispatch
selection, restart envelopes, a one-dispatch ledger, canonical reread
classification, and a rollback envelope that always requires a fresh governed
operation.

It deliberately has no HTTP client and cannot mutate Hermes.
