# Governed Hermes update and rollback contract audit

## Verdict

The audit and preview-only prototype passed. A production update action remains
blocked.

Hermes has native update mechanisms, but none is a complete governed update
transaction. Cabinet can safely expose a read-only preview after independently
pinning all evidence. It must not expose Apply until Hermes adds a structured
prepare/apply/status/rollback contract, or an equally authoritative native
contract is approved. Cabinet must not implement its own `git reset`, dependency
installer, state migration, or service restart path because that would make
Cabinet a second executor.

Audit cutoff: 2026-07-23 at 15:43:21 UTC. The official `main` branch moves
quickly; every future preview must pin a new immutable target and regenerate all
evidence.

## Exact audited state

| Item | Exact finding | Governance consequence |
| --- | --- | --- |
| Installed Hermes | Official git install, `0.19.0`, revision `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`, branch `main` | Current revision is a valid rollback candidate only after its runtime and state snapshot are verified |
| Installed source drift | Zero local commits and zero tracked edits; one untracked directory exists in the source checkout | Upstream update would include untracked content in its autostash. The content needs an explicit preserve/port/abandon decision before any update |
| Current official target | `01b0451909eaada46c455387706ddf21ca1e113c`, 265 commits ahead and zero behind relative to the installed revision | Target must be the full SHA, never `latest`, `main`, or version `0.19.0` |
| Published release | Latest official release is `v2026.7.20`, Hermes `0.19.0` | Installed and current `main` both report `0.19.0`; version text cannot identify the update target |
| Machine runtime | Darwin arm64; installed venv Python `3.11.15`; Hermes-managed Node `22.22.3` | Current target is untested on this exact machine contract until an isolated side-by-side test passes |
| Approved Skills companion | Revision `78a803a013547794a295d674982f1fe0515f5713`; two custom commits on base `d7b36070ef807841699ad32c5b6af547fee3ff64`; 442 commits behind installed Hermes | Compatibility with the target is unknown. Rebase/port and machine-contract tests are mandatory |
| ACP companion | Revision `139214139446dd705423589afb0c9ba072e4bafe`; two custom commits on top of installed Hermes | Compatibility with the target is unknown. Upstream ACP changed after the companion base |
| Other local companion checkout | A separate dirty office/UI checkout was detected | It is outside this update target and must remain untouched; its dirty state prevents assuming a coordinated update |

Primary evidence:

- [Installed revision](https://github.com/NousResearch/hermes-agent/commit/55759cb2737cd3870f9de4693f66fa38eaf0dd2b)
- [Official target at the audit cutoff](https://github.com/NousResearch/hermes-agent/commit/01b0451909eaada46c455387706ddf21ca1e113c)
- [Exact installed-to-target comparison](https://github.com/NousResearch/hermes-agent/compare/55759cb2737cd3870f9de4693f66fa38eaf0dd2b...01b0451909eaada46c455387706ddf21ca1e113c)
- [Latest published release](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.7.20)

## Native contracts

### Install-method routing

Hermes detects the running install from a code-scoped `.install_method` stamp,
then legacy state, managed/Nix signals, and git checkout presence. Supported
method names are `git`, `docker`, `nix`, `nixos`, and `unknown`.

- Git uses `hermes update`.
- Docker directs the operator to pull the published image and recreate/restart
  the container.
- Nix and NixOS direct the operator to the owning Nix profile, flake,
  `nixos-rebuild`, or Home Manager flow.
- Managed Hermes refuses self-update.

Source: [install-method detection and method-specific guidance](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/hermes_cli/config.py#L400-L600).

### CLI update check

`hermes update --check [--branch NAME]` is read-only with respect to installation
content, but it performs a git fetch. It emits human text, not a versioned JSON
contract. Full-history checkouts report a commit count; shallow checkouts can
degrade to same/different SHA presence only. Docker and Nix are rejected with
method-specific guidance.

The parser also supports `--backup`, `--no-backup`, `--yes`, `--branch`,
Windows `--force`, and Windows `--force-venv`.

Sources:

- [CLI update parser](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/hermes_cli/subcommands/update.py)
- [CLI check and apply implementation](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/hermes_cli/main.py)

### Dashboard/backend check and apply

`GET /api/hermes/update/check?force=true` returns:

- `install_method`
- `current_version`
- `behind`
- `update_available`
- `can_apply`
- `update_command`
- `message`
- up to 20 recent commits for a behind git checkout

It does not return the current SHA, target SHA, branch, dirty-state inventory,
companion compatibility, migration plan, restart scope, rollback target, or
preview fingerprint.

`POST /api/hermes/update` immediately backgrounds `hermes update` for a git
install. It has no request body for a prepared target, confirmation, stale-state
fingerprint, idempotency key, rollback policy, or side-by-side evidence.

Source: [official backend update routes](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/hermes_cli/web_server.py#L4047-L4240).

### CLI apply behavior

The git path:

1. Optionally creates a quick state snapshot and full backup. Backup failure is
   non-blocking.
2. Discards isolated npm lockfile churn.
3. Autostashes tracked and untracked local content.
4. Fetches the selected origin branch.
5. Switches branches when necessary.
6. Fast-forwards, or hard-resets to the remote when histories diverge.
7. Syntax-checks a small critical-file set and hard-resets to the captured
   pre-pull SHA only on that early syntax failure.
8. Reinstalls Python dependencies and repairs interrupted venv states.
9. Refreshes active lazy backends, Node dependencies, web assets, and an
   existing Desktop build.
10. Refreshes the model catalog, synchronizes bundled Skills into all profiles,
    may seed missing profile environment files, and syncs memory companion
    profile state.
11. Applies safe/noninteractive config migrations or prompts when interactive.
12. Attempts to restore cron jobs if migration reduced their count.
13. Optionally refreshes an installed Computer Use driver.
14. Restarts every running gateway/profile and managed dashboard processes.

The update is therefore multi-stage and non-atomic. Current upstream explicitly
tracks separate incomplete core-install and lazy-refresh states, which is useful
recovery behavior but also proof that `exit 0/1` alone is not a complete
transaction result.

### Desktop updater

Desktop has two distinct surfaces:

- Passive local checks inspect the configured branch, current SHA, target SHA,
  commit log, and dirty boolean.
- Apply either hands off to a staged Tauri bootstrap updater, exposes a manual
  CLI command, or on POSIX runs the native CLI update, rebuilds Desktop, swaps
  the bundle, and relaunches.

Remote Desktop uses the backend routes above and polls action status. A dropped
connection during restart is treated as expected, then the client polls for the
backend to return. If it does not return, the UI reports that the update may not
have completed. This is an implicit ambiguous outcome, not a durable
`outcome_unknown` receipt.

Source: [Desktop update orchestration](https://github.com/NousResearch/hermes-agent/blob/01b0451909eaada46c455387706ddf21ca1e113c/apps/desktop/electron/main.ts).

Desktop Management requires an ephemeral credential and is not an approved
durable Cabinet management boundary, so Cabinet cannot adopt this path merely
because Desktop has richer local update state.

## Rollback and migration findings

Hermes has state snapshots, imports, filesystem checkpoints, and curator
rollback features. None is a native rollback transaction for an applied Hermes
code/dependency/Desktop/migration update.

The updater's automatic code rollback is narrowly scoped to a critical Python
syntax failure immediately after pull. After dependencies, generated assets,
profile Skills, configuration migrations, caches, companion refreshes, or
service restarts begin, there is no general command that restores the whole
pre-update system to one verified revision and state snapshot.

Consequences:

- A pre-update git SHA is necessary but insufficient.
- State rollback must be schema-aware.
- Rollback must account for every running profile and companion.
- An update cannot be called reversible until an isolated promotion and pointer
  reversal test proves both code and state compatibility.
- A failed backup must block a governed update even though native
  `hermes update` currently continues.

## Exact upstream gaps

1. No versioned machine-readable CLI `check --json` contract.
2. Backend check omits immutable current and target revisions.
3. No native prepare token that binds target, install method, patches, machine,
   companions, migrations, restarts, rollback, and expiry.
4. No stale-state compare-and-swap at apply time.
5. No idempotency key or durable one-dispatch receipt.
6. No typed confirmation field or confirmation policy.
7. No first-class local commits/patches/untracked classification. Only a broad
   dirty/autostash behavior exists.
8. No companion compatibility manifest for Skills CLI, ACP, Desktop, plugins,
   MCP, or local companion toolchains.
9. No side-by-side build/test contract or machine-readable evidence bundle.
10. No complete migration preview.
11. No complete restart fleet/downtime preview.
12. No native full-system rollback command or rollback verification receipt.
13. No explicit `outcome_unknown` state. Clients infer ambiguity from process,
    connection, or service observations.
14. Release version is not a unique target identity, and commit changelogs are
    capped summaries rather than release notes for the exact main delta.
15. The apply endpoint starts immediately and cannot be safely used as a
    governed commit endpoint.

## Recommended governed architecture

### 1. Discover

Read native state without mutation:

- exact code revision, branch, official remote identity, install method
- tracked edits, untracked count/fingerprint, local commits and merge base
- Hermes version plus config/state schema versions
- machine OS/architecture/Python/Node and free-space contract
- all running profiles and services
- approved companion revisions and their bases
- available immutable target and exact commit set

Store only bounded summaries in Cabinet. Hermes remains canonical.

### 2. Prepare

Ask a future native Hermes prepare endpoint to create an expiring intent:

```json
{
  "operation_id": "stable-idempotency-key",
  "current_revision": "full-sha",
  "target_revision": "full-sha",
  "state_fingerprint": "sha256",
  "rollback_revision": "full-sha",
  "required_tests": [],
  "restart_scope": [],
  "expected_downtime_seconds": null,
  "blocked_reasons": []
}
```

The intent must not update refs, files, packages, profiles, services, or state.

### 3. Side-by-side qualification

Build the exact target outside the running checkout with isolated copied
fixtures and no production credentials. Required gates:

- critical Python compile/import and dependency integrity
- exact machine runtime compatibility
- config migration preview and reversible fixture migration
- read-only Skills inventory/canary through the approved companion
- ACP no-tools transport contract
- Desktop/backend contract version
- plugin and MCP discovery without mutations
- multi-profile gateway start, drain, restart, and port-contention tests
- state snapshot restore and pointer-reversal rehearsal
- secret/private-path scan of evidence

The approved Skills and ACP companions must be ported to the target or replaced
by proven upstream equivalents before these gates can pass.

### 4. Confirm

Re-read native state and reject any fingerprint drift. Require an exact phrase
that includes current, target, and rollback revisions:

`UPDATE HERMES <current-12> TO <target-12> ROLLBACK <rollback-12>`

Confirmation must be server-side, short-lived, principal-bound, and consumed
once.

### 5. Commit through Hermes

Cabinet submits the prepared token and idempotency key to one native Hermes
commit endpoint. Hermes owns backup, drain, promotion, migrations, companion
activation, restart, verification, and rollback. Cabinet never runs git,
package-manager, migration, or service commands itself.

### 6. Verify and reconcile

Terminal success requires:

- exact target revision
- expected state schema
- every required service healthy at the expected revision
- companion contract checks passed
- durable native receipt

If dispatch may have started and terminal state is not proven, record
`outcome_unknown`, disable retry, and poll only native status/reconciliation.
Resolve to `succeeded`, `rolled_back`, or `not_applied` only from exact revision,
state, and service evidence.

## Prototype

The isolated prototype implements:

- deterministic preview fingerprint and operation ID
- install-method routing
- immutable current/target/rollback revisions
- local commit/tracked/untracked patch blocking
- machine contract
- required Skills/ACP companion compatibility
- required side-by-side test evidence
- restart scope and measured downtime field
- exact typed confirmation bound to the preview fingerprint
- stale-preview rejection
- `outcome_unknown` with retry disabled
- native-observation reconciliation

It intentionally contains no apply, filesystem, network, process, update, or
restart adapter.

Test result: 7 tests passed, 0 failed.

## Recommendation

Merge no production update control from this stream. Keep Cabinet preview-only
and open an upstream Hermes contract request for versioned
discover/prepare/commit/status/rollback endpoints with immutable revisions,
idempotency, stale-state protection, companion qualification, and explicit
ambiguous outcomes. Only enable Apply after the approved Skills and ACP
companions pass side-by-side qualification against a pinned target and a full
rollback rehearsal succeeds.

Production Cabinet, canonical Cabinet data, environment files, Hermes
checkouts/venvs/state, Skills state, services, credentials, and network
exposure were not modified. No update or restart command was run.
