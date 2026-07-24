# Documentation index

Use this page to distinguish current operating contracts from dated design and
acceptance records. A document can remain useful historical evidence without
describing the product as it works today.

## Start here

- [`CURRENT_IMPLEMENTATION.md`](CURRENT_IMPLEMENTATION.md): verified source,
  runtime, packaging, and distribution state for this checkout.
- [`../README.md`](../README.md): product overview, installation, and the
  current Cabinet/Hermes runtime boundary.
- [`CLAUDE.md`](CLAUDE.md): contributor architecture and implementation rules.
- [`MACOS_SUPERVISED_CABINET.md`](MACOS_SUPERVISED_CABINET.md): current
  loopback-only production supervision contract.
- [`PRODUCTION_ACCEPTANCE_STABILIZATION.md`](PRODUCTION_ACCEPTANCE_STABILIZATION.md):
  current production acceptance verdict and the historical blocker trace.

## Current reference and operations

These files are maintained as current contracts:

- [`AUTH.md`](AUTH.md)
- [`CABINETAI.md`](CABINETAI.md)
- [`CONNECT_KNOWLEDGE_PRD.md`](CONNECT_KNOWLEDGE_PRD.md)
- [`CONTRIBUTING_I18N.md`](CONTRIBUTING_I18N.md)
- [`HERMES_SKILLS_MANAGEMENT_CONTRACT.md`](HERMES_SKILLS_MANAGEMENT_CONTRACT.md)
- [`SKILLS_PLAN.md`](SKILLS_PLAN.md)
- [`deployment-packaging-versioning.md`](deployment-packaging-versioning.md)
- [`microsoft-integration-status.md`](microsoft-integration-status.md)
- [`notifications.md`](notifications.md)

The top-level [`TELEMETRY.md`](../TELEMETRY.md) is the public privacy contract.
[`TELEMETRY.md`](TELEMETRY.md) contains the implementation detail.

## Product specifications and build records

The remaining top-level files in `docs/` are feature specifications, design
records, test guides, or build logs. Their status line and dated evidence apply
to the feature or release they name. They are not a substitute for
`CURRENT_IMPLEMENTATION.md`.

In particular:

- `*_PRD.md`, `*_PLAN.md`, `*_SPEC.md`, `TASKS.md`, `SIDEBAR.md`, and
  `CABINET_UI_WORK_SUMMARY.md` preserve feature intent and implementation
  history.
- `WINDOWS_PR139_SMOKE_TEST.md` is the immutable v0.4.4/PR #139 test procedure,
  not the current release guide.
- `RELEASE_NOTES_v0.4.0.md` and `docs/releases/*` are release-specific records.
- `docs/superpowers/specs/*` are dated design proposals.

## Hermes records

- `plans/hermes-m0-*` through `plans/hermes-m8-*` are dated milestone evidence.
  Pre-cutover and Gateway statements in those records describe the milestone
  at the time it was accepted.
- [`plans/hermes-desktop-capability-parity.md`](plans/hermes-desktop-capability-parity.md)
  contains a generated, timestamped parity snapshot. Generated percentages are
  not live health.
- `evidence/hermes-*` and `research/parallel/*` are bounded acceptance and
  research artifacts. Preserve failed and superseded runs as evidence.
- The current native conversation path is ACP over stdio. Agent API,
  Management API, Gateway, and Skills CLI contracts are separate surfaces.

## User-facing knowledge

- `resources/getting-started/*` and `resources/getting-started-he/*` are seeded
  in-product guides.
- `cabinet/*.md` contains integration guidance used by Cabinet content.
- `mcps/*/README.md`, `cabinetai/README.md`, and `cli/README.md` document their
  own packages.
- `src/lib/agents/library/*/persona.md` files are runtime persona prompts, not
  project documentation.

## Documentation maintenance

1. Verify current claims against source, tests, runtime output, and release
   state before editing.
2. Update `CURRENT_IMPLEMENTATION.md` when the architecture, runtime boundary,
   install kinds, or distribution state changes.
3. Preserve dated evidence. Add a supersession note instead of rewriting what a
   historical run observed.
4. Keep local Markdown links valid and use app-root links only when the target
   is an actual Cabinet route.
5. Append every documentation change to [`../PROGRESS.md`](../PROGRESS.md).
