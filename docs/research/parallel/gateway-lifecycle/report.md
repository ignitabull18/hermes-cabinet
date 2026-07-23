# Profile-safe gateway lifecycle research

## Outcome

The installed Hermes commit
`55759cb2737cd3870f9de4693f66fa38eaf0dd2b` does not provide a safe
multi-profile lifecycle contract for Cabinet. The default launchd service is
not explicitly profile-bound, while every generated launchd start has broad
`--replace` authority. In combination, a sticky active profile can redirect the
nominal default service and its replacement path can terminate a gateway in a
different Hermes home when both gateways share a credential-scoped platform
lock.

This stream produced a non-dispatching behavior model and 12 passing tests. It
did not change Hermes source, profiles, launchd, gateway processes, ports,
services, environment, or production.

## Evidence

### Installed source

- `hermes_cli/main.py:590-608`: a bare invocation with root `HERMES_HOME`
  consults root `active_profile`; only the s6 supervised-child path is exempt.
- `hermes_cli/gateway.py:1755-1778`: `_profile_arg()` deliberately returns an
  empty string for the default profile.
- `hermes_cli/gateway.py:3869-3881`: the detached command uses `_profile_arg()`
  and always appends `gateway run --replace`.
- `hermes_cli/gateway.py:3944-4001`: generated launchd arguments include a
  profile only when `_profile_arg()` is non-empty and always include
  `--replace`.
- `gateway/platforms/base.py:2857-2911`: an adapter armed by explicit
  `--replace` may take over a verified live credential-lock holder across
  Hermes homes.
- `gateway/kanban_watchers.py:794-817`: `dispatch_in_gateway` defaults true and
  a single machine-global lock makes the first gateway to start the dispatcher.
  The shared lock prevents duplicate writers, but ownership is race-based.
- `hermes_cli/profiles.py:1629-1636`: distinct independent profile ports are an
  operator convention, not an allocator or preflight contract.
- `gateway/platforms/api_server.py:5608`: API listener collision is detected
  only after the OS bind returns `EADDRINUSE`.
- `website/docs/user-guide/multi-profile-gateways.md:59-159`: multiplexing is a
  single default-profile process; named profiles must not bind their own HTTP
  listeners and are addressed under `/p/<profile>/`.

### Read-only runtime snapshot

At audit time:

- `ai.hermes.gateway` was loaded without a live PID. Its plist had root
  `HERMES_HOME` and bare `gateway run --replace`.
- `ai.hermes.gateway-operator-os` ran PID 29499 with
  `--profile operator-os gateway run --replace`.
- `ai.hermes.gateway-manisha-patel` ran PID 1470 with
  `--profile manisha-patel gateway run --replace`.
- PID 1470 owned TCP ports 8642 and 8644. The default profile's state file
  referred to stale PID 19770.

These checks were read-only. They explain the reported profile confusion and
port contention without treating stale status as a live owner.

## Root cause

The profile home, CLI profile, supervisor service label, runtime PID/lock, and
listener ownership are related but not represented as one immutable identity.
Default is represented by omission (`no --profile`) even though omission is
also the signal to follow sticky `active_profile`. Routine supervisor recovery
then carries the same broad `--replace` capability intended for an explicit
operator handoff.

Runtime PID/lock files are already profile-home scoped and platform credentials
are intentionally machine-global. Those boundaries should remain. The defect
is the missing exact identity check before replacement and the absence of a
host-level ownership contract for listeners and shared dispatch.

## Proposed upstream source changes

1. Add an internal service-argv helper that always emits an explicit profile,
   including `--profile default`. Apply it to launchd, systemd, Windows,
   detached fallback, and s6 generation. Update status process matching to
   recognize explicit default.
2. Replace routine supervisor `--replace` with a same-profile operation. It may
   terminate only a process matching canonical home, profile ID, service ID,
   PID start time, and prepared generation. Cross-profile credential takeover
   must fail closed; if retained for recovery, expose it as a separately named,
   exact-target operator action.
3. Persist `profile_id`, canonical home, supervisor identity, PID start time,
   and generation in runtime identity/status. Make restart acceptance require a
   new process identity, the prepared generation, readiness, and expected
   listeners.
4. Require named independent profiles to configure ports explicitly whenever a
   port-binding platform is enabled. Add a host preflight across profile
   configs and a machine-global TCP lease keyed by normalized bind address and
   port. Wildcard binds must conflict with specific-address binds. The kernel
   bind remains final authority.
5. Model the Agent API listener as a profile/platform-owned leased resource and
   report configured endpoint, lease owner, actual bind, and readiness.
6. Replace first-starter Kanban dispatch ownership with
   `dispatcher_owner_profile` per board and a shared per-board lock. Shared
   Kanban storage remains machine-global; profile-scoping the existing singleton
   lock would incorrectly permit concurrent dispatchers.

An upstream Hermes PR is recommended before Cabinet gains live gateway
lifecycle controls. The PR should land service identity and same-profile
replacement first; port leases and explicit dispatcher ownership can follow as
separate reviewable commits.

## Migration plan

1. **Observe:** add a doctor/status report showing service label, configured
   profile, canonical home, live PID/start time, generation, listeners, and
   dispatcher ownership. Do not repair automatically.
2. **Warn:** flag bare default service argv, named profiles with implicit
   listener defaults, collisions, stale runtime identity, and non-default
   dispatcher ownership.
3. **Regenerate services:** convert default to explicit `--profile default` and
   broad replacement to same-profile replacement. Refuse migration if current
   label, home, argv, or live PID identifies another profile.
4. **Configure ports:** preserve default-profile defaults for compatibility;
   require explicit unique ports for named independent gateways. In multiplex
   mode, retain only the default listeners.
5. **Assign dispatchers:** boards without metadata migrate to owner `default`.
   If a live non-default gateway currently owns dispatch, surface a governed
   drain/restart plan rather than silently moving it.
6. **Restart one profile at a time:** preview the exact old identity, require a
   stale-state precondition and typed confirmation, dispatch once, then verify
   the new generation and ready listeners. Report `outcome_unknown` if the
   dispatch result cannot be reconciled.

Rollback uses the previously captured service definition and port/dispatcher
configuration, but must still pass exact identity checks. It must never restore
a bare default invocation with broad replacement authority.

## Prototype

`experiments/management/gateway-lifecycle/gateway_lifecycle.py` models:

- canonical profile/home/service identity;
- explicit service argv for default and named profiles;
- same-profile-only replacement authorization;
- migration refusal on identity drift;
- named-profile port explicitness, wildcard collision detection, lease keys,
  and multiplex restrictions;
- explicit per-board dispatcher ownership; and
- prepared restart fingerprints and post-restart verification.

It is deliberately inert and has no Hermes imports or mutation/bind calls.

## Risks and blockers

- Changing default service argv requires status/process matching and lifecycle
  tests across every supported supervisor.
- Strict named-profile port validation can break existing installations that
  currently rely on implicit defaults; warning and inventory must precede the
  hard error.
- Bind overlap is OS-specific, especially IPv4/IPv6 wildcard behavior. A lease
  reduces races but cannot replace an actual bind check.
- Credential locks must remain global. Re-keying them per profile would permit
  duplicate bot/session ownership.
- Dispatcher ownership migration may move active work; board-level assignment
  and a governed drain are required.
- Cabinet cannot safely emulate missing lifecycle semantics with shell process
  matching. Upstream identity, precondition, receipt, and readback contracts are
  required for live management.

## Verification

```text
python3 -m unittest -v test_gateway_lifecycle.py
Ran 12 tests in 0.076s
OK
```

Production touched: **false**.
