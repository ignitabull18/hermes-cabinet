# Current implementation

Verified 2026-07-24 against `main` commit
`361ee44878d4aa9b1a7ce36cc4409aca666c7600`.

This is the current-state source of truth for this Hermes-first fork. Dated
PRDs, milestone plans, release notes, and acceptance artifacts keep their
historical meaning and should not override this page.

## Repository and release identity

- Package version: `0.5.3`.
- The active checkout was a clean `source-custom` install matching
  `origin/main` at the start of this documentation audit. The documentation
  edits themselves now make the checkout intentionally dirty.
- The supervised local app reports Cabinet `0.5.3`, stores data under
  `~/.cabinet/data`, and returned HTTP 200 from `/api/health` during this
  audit.
- The current supervised release is a clean, SHA-pinned runtime worktree. It is
  intentionally separate from the editable source checkout.
- `v0.5.3` exists as a Git tag, but no `v0.5.3` GitHub Release exists in either
  `cabinetai/cabinet` or `ignitabull18/hermes-cabinet`.
- The public npm registry reported `cabinetai@0.5.0` and
  `create-cabinet@0.5.0` as latest during this audit. Repository version
  `0.5.3` must not be described as publicly released until the GitHub and npm
  release gates pass.

## Runtime architecture

Cabinet has three process boundaries:

1. The Next.js application owns the UI and HTTP API routes.
2. The Cabinet daemon owns structured local adapters, PTY sessions, scheduled
   jobs, and the event bus.
3. Electron optionally packages and supervises the application and daemon for
   desktop distribution.

The normal development wrappers prefer port `4000` for the app and `4100` for
the daemon, auto-bumping when those ports are occupied. A direct production
`next start` uses port `3000` unless `PORT` is set. The daemon still defaults to
`4100` unless `CABINET_DAEMON_PORT` is set.

The repository supports four install kinds:

- `source-managed`
- `source-custom`
- `electron-macos`
- `electron-windows`

## AI runtime boundary

`CABINET_RUNTIME_MODE` is server-selected:

- `cabinet` remains the default. Cabinet owns local provider selection,
  structured adapter execution, terminal execution, scheduler behavior, and
  related UI.
- `hermes` makes Hermes the visible execution source of truth. Native
  conversations use the approved, server-owned ACP companion over stdio with
  an exact profile and no-tools policy. Cabinet must not silently fall back to
  a local provider or PTY.

Agent API, Management API, Gateway, and Skills CLI integrations remain separate
feature boundaries. They are not prerequisites for the native ACP conversation
path unless the specific surface being used requires them.

The final-route r4 production acceptance artifact is the authoritative accepted
baseline. Earlier failed reports remain historical evidence.

## Knowledge and structured state

- Markdown files and assets are the durable knowledge source.
- `<data-dir>/.cabinet.db` stores local runtime, conversation, activity,
  job-run, and index state.
- Git supplies page history and restoration.
- A Cabinet can link a repository with `.repo.yaml`.
- Per-room external knowledge-source configuration lives under
  `<room>/.agents/.config/knowledge-sources.json`.

## Implemented product surfaces

The checked source includes:

- filesystem-backed pages, assets, uploads, search, history, references, and
  embedded apps;
- task/conversation views, 43 built-in persona templates, provider adapters,
  scheduled work, skills, channels, and terminal support;
- Hermes cockpit, Control Center, sessions, runs, capability diagnostics,
  governed interventions, and Skills management;
- Git, Gmail, Google Drive, Microsoft, MCP, registry, update, backup,
  diagnostics, telemetry, and onboarding routes;
- inline PDF, CSV, website, Google Workspace, Word, Excel, and PowerPoint
  viewers.

Feature presence does not prove live provider readiness. Provider credentials,
external services, management endpoints, and live Hermes health must be
verified independently.

## Packaging and distribution

- `release.yml` creates a draft GitHub Release, builds Linux and macOS
  standalone app bundles, then publishes `cabinetai` and `create-cabinet`.
- `electron-release.yml` is manually dispatched for macOS and Windows desktop
  builds and packaged-app smoke tests.
- The current standalone bundle matrix does not include `win32-x64`; Windows
  `cabinetai run` therefore uses the source fallback.
- The release manifest advertises native Windows Electron assets, but those
  assets are produced by the separate desktop workflow.
- `cli/package.json` is versioned `0.5.3` but currently depends on
  `cabinetai@0.4.4`. This contradicts the intended lockstep release contract
  and must be fixed before a truthful `0.5.3` public release.

## Current live limitations

- `/api/health` was healthy during this audit.
- `/api/hermes/health` returned `probe_unavailable` during this audit. This
  proves the Cabinet failure boundary, not live Hermes readiness.
- The supervised macOS service starts only the production Next application.
  It does not own the Cabinet daemon, Hermes, Gateway, Desktop, Tailscale, or a
  public listener.
- The supervised native Hermes conversation contract remains no-tools only.
- The generated parity register contains timestamped observations. It must not
  be treated as a live dashboard after its freshness window expires.
- Forty locale catalogs are selectable, but `npm run i18n:check` currently
  reports six missing English keys and 81 missing Hebrew keys. That check does
  not inspect the other 38 catalogs or explicit empty values. The
  pre-hydration bootstrap recognizes only English, Hebrew, and the two Chinese
  locales, so other selections initially use English document metadata until
  hydration. The locale surface is not translation-complete.

## Verification sources

- `package.json`, `cli/package.json`, `cabinetai/package.json`
- `src/lib/runtime/runtime-config.ts`
- `src/lib/system/install-metadata.ts`
- `src/lib/agents/adapters/hermes-runtime.ts`
- `src/lib/hermes/*`
- `.github/workflows/release.yml`
- `.github/workflows/electron-release.yml`
- `deploy/macos/ai.cabinet.plist.template`
- `scripts/start-cabinet-supervised.mjs`
- `docs/research/parallel/acceptance-harness/final-route-live-r4-20260723/`
