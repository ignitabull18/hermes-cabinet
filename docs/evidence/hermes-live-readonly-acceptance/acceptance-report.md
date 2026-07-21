# Hermes Phase 4A live read-only acceptance

Captured: 2026-07-20T04:26:28Z  
Implementation: `0f257a380c6c1a02bd0cbca7f85b1db425c42f22`  
Classification: Configuration readiness and contract evidence only

## Result

Live read-only acceptance did not run because the approved Cabinet server configuration is absent. No isolated Cabinet server was started, no credentials were copied or created, no production process was restarted or reconfigured, and no mutation endpoint was called.

This directory contains no live-runtime projection, live parity update, or live screenshots. Fixture evidence from earlier phases remains separate and unchanged.

## Safe topology observation

| Component | Safe observation | Result |
| --- | --- | --- |
| Hermes Agent API | Loopback service on port 8642 | Healthy unauthenticated health response; installed identity 0.18.2 |
| Hermes management | Loopback service on port 56314 | Authentication boundary present; no authenticated read performed |
| Hermes Gateway | Expected loopback port 8645 | No listener observed |
| Cabinet production | Expected port 4000 | No listener observed |
| Cabinet isolated review | Reserved port 4011 | No listener observed; review instance not started |
| Private access | Tailscale | Client stopped; no Serve or Funnel used |
| Active Hermes profile | Authenticated runtime fact | Unknown because approved Cabinet authentication configuration is absent |

The Agent API is managed as a local background service. The management service is a child of the installed Hermes Desktop application. Cabinet was not running on port 4000 during the audit.

## Configuration handoff

The ignored local Cabinet environment file exists with owner-only permissions, but none of the required Hermes variable names is present. The shell environment also lacks them. Supply these through that existing approved local file or the approved Cabinet server startup environment:

- `CABINET_HERMES_API_URL`: supplied by the local Hermes Agent service configuration.
- `CABINET_HERMES_API_KEY`: supplied by the local Hermes Agent authentication setup.
- `CABINET_HERMES_MANAGEMENT_URL`: supplied by the installed Hermes Desktop management service.
- `CABINET_HERMES_MANAGEMENT_TOKEN`: supplied by the installed Hermes Desktop launch boundary; the existing server-only compatibility equivalent is also accepted.
- `CABINET_HERMES_GATEWAY_URL`: supplied by the local Hermes Gateway configuration.
- `CABINET_HERMES_GATEWAY_TOKEN`: supplied by the local Hermes Gateway authentication setup.
- `CABINET_HERMES_PROFILE`: selected by the Cabinet operator configuration.

`CABINET_HERMES_TIMEOUT_MS` is absent and safely uses the existing 3000 ms default. `CABINET_HERMES_INTERVENTIONS_ENABLED` is absent and therefore disabled as required for Phase 4A.

Do not paste values into the browser. Once the server-only values are available through the approved mechanism and Gateway is listening, the isolated review instance can bind to `127.0.0.1:4011` with interventions still disabled.

## Live-source and discrepancy status

Only the unauthenticated Agent health check and the management authentication boundary were reached. They are topology observations, not source-specific canonical projection evidence and earn no Current Live Visibility or Live-Proven credit.

Because authenticated collection could not begin, the prior Telegram polling conflict, Gateway disagreement, session-versus-Git repository association, and memory graph profile/count differences were not reclassified or claimed as current. No parity percentages changed.

## Safety result

- Interventions remained disabled.
- Zero Hermes mutation endpoints were called.
- No external message, provider change, runtime control, or repository mutation occurred.
- No secret value, token identity, credential-bearing URL, local path, or local user identity is stored in this evidence.
- `/cockpit` was not changed.

## Verification

- Full unit suite: 555 passed, 0 failed.
- Focused Hermes contract suite, including authority, generator failure modes, recursive non-egress, readiness, and intervention gates: 132 passed, 0 failed.
- Focused readiness and gate tests: 16 passed, 0 failed.
- Production-browser workflows: 2 passed at 1440x900 and 390x844; reduced motion, zero horizontal overflow, zero relevant console errors, and zero mutation calls verified.
- TypeScript, focused ESLint, production build, and `git diff --check`: passed.
- Existing unrelated warnings: two Turbopack NFT trace warnings and Playwright's `NO_COLOR`/`FORCE_COLOR` notice.
