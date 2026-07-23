# Hermes memory and Supermemory management audit

Date: 2026-07-23

Branch: `research/hermes-memory-supermemory-management`

Installed Hermes boundary: `55759cb2737cd3870f9de4693f66fa38eaf0dd2b`

## Executive result

Hermes has useful provider discovery, configuration, selection, runtime tools,
and built-in-memory UI contracts, but it does **not** currently expose a safe,
machine-readable management plane for Supermemory records, health, graph,
provenance, migration, export, or import.

Cabinet can safely show a metadata-only provider card after an upstream
read-only contract is added. It must not reuse Hermes' current Starmap payload:
that graph is built from local `MEMORY.md` / `USER.md` and learned skills, not
Supermemory, and it includes full memory bodies. It must also not expose the
installed `supermemory-forget` query path: Hermes searches and immediately
deletes the first result without a durable preview token or exact-match commit.

This stream made no Hermes, Supermemory, configuration, credential, memory,
service, or production calls or changes.

## Installed capability matrix

| Capability | Current installed Hermes contract | Cabinet-safe result |
|---|---|---|
| Provider selection | One external provider via `memory.provider`; REST can select only a provider classified `ready` | Candidate after governed preview, fingerprint, restart/activation disclosure, reread |
| Plugin discovery | Bundled and user plugin directories; bundled wins; discovery imports providers and calls local `is_available()` | Show source/version/digest only; no arbitrary plugin output |
| Supermemory configured | `is_available()` checks only whether `SUPERMEMORY_API_KEY` is present | Show `present/absent/unknown`, never value or suffix |
| Runtime availability | Initialization can lazy-install the SDK and construct a client; failures are logged and `_active` becomes false | Upstream runtime state endpoint required; configured is not initialized or healthy |
| Health | CLI status invokes a live Supermemory probe and formats prose | Upstream structured, redacted, bounded health result required; Cabinet must not probe vendor directly |
| Search | Agent tool returns IDs, memory content, similarity | Agent-only; never a metadata-only browser response |
| Remember/store | Agent tool accepts content/metadata, returns ID and content preview | Governed action requires stable custom ID/idempotency, exact scope, dispatch receipt, reread |
| Forget exact ID | Agent tool directly calls delete by ID | Critical and irreversible; exact immutable ID digest, scope digest, typed confirmation, no retry |
| Forget by query | Searches top five and deletes the first match | **Forbidden** until dry-run token plus exact commit contract exists |
| Built-in reset | REST unlinks `MEMORY.md` and/or `USER.md` | Separate destructive domain; does not erase Supermemory |
| Memory graph / Starmap | `/api/learning/graph` reads local built-in memory and returns labels and bodies | Not a Supermemory graph and unsafe for metadata-only management |
| Supermemory graph | No Hermes provider contract | Upstream content-bearing feature; keep outside management metadata surface |
| Scope | Config supports shared default, `{identity}` profile template, and custom allowlisted containers | Show only `shared/profile/custom/unknown` and counts; never literal tags |
| Provenance | Writes add `sm_source: hermes`; conversation ingest includes Hermes metadata | Upstream structured provenance summary required; never content or raw vendor metadata |
| Migration | No Hermes migration contract | Upstream preview/inventory/apply/reconcile contract required |
| Export | General Hermes backup includes local config under Hermes home; Supermemory provider declares no external backup paths | Does not export vendor memories; upstream export job metadata required |
| Import | General Hermes import overlays local files | Does not import vendor memories; upstream schema/version/dedup preview required |

Installed-source evidence: [provider lifecycle](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/agent/memory_provider.py),
[provider discovery](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/plugins/memory/__init__.py),
[Supermemory provider](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/plugins/memory/supermemory/__init__.py),
[dashboard memory endpoints](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/web_server.py),
[local learning graph](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/agent/learning_graph.py),
and [backup/import](https://github.com/NousResearch/hermes-agent/blob/55759cb2737cd3870f9de4693f66fa38eaf0dd2b/hermes_cli/backup.py).

## Safe browser projection

Allowed fields:

- selected provider and state: built-in, selected, missing, unknown;
- plugin discovered, bundled/user source, manifest version and digest;
- configured and credential presence tri-state only;
- local availability and runtime state as separate values;
- health state, bounded error code, checked timestamp, and observation age;
- scope class (`shared`, `profile`, `custom`, `unknown`) and custom-scope count;
- capture/recall enabled flags and bounded modes/counts;
- exposed tool names with read/write/delete risk classes;
- capability support enums for search, store, forget, graph, migration,
  export, and import;
- provenance source and installed Hermes revision;
- a canonical state fingerprint used for stale-state rejection.

Forbidden fields include API keys, tokens, raw URLs or local paths, literal
container/project/profile identifiers, memory IDs, memory text, previews,
queries, results, profile facts, messages, vendor metadata, and graph nodes.

## Governed mutation model

Every action is preview-only until a separate executor exists. A preview binds
the installed Hermes identity, scope digest, exact target digest, canonical
before-state fingerprint, intended after-state fingerprint, approval,
idempotency key, and expiry. Commit must reread and reject stale state.

| Action | Risk | Minimum approval | Verification / rollback |
|---|---|---|---|
| Select/configure provider | High | Operator | Reread config plus new-session runtime state; compensate to prior provider |
| Store memory | High | Operator | Stable custom ID or upstream idempotency receipt; reread by exact ID; no blind retry |
| Forget exact memory | Critical | Typed exact target | Verify absence by exact ID; irreversible |
| Forget by query | Forbidden | Unavailable | Requires upstream dry-run token and exact match set |
| Delete scope/container | Catastrophic | Owner/admin plus typed scope | Pre-export evidence, inventory counts, verify scope absence; irreversible |
| Migration apply | Critical | Typed source and destination scopes | Preview inventory/dedup/conflicts, resumable receipt, reconcile counts |
| Export | High | Operator/owner as required | Job ID, bounded counts, checksum, expiry; never return contents in status |
| Import | Critical | Typed destination scope | Schema/checksum/dedup preview, idempotency, post-import counts |

Official Supermemory documentation says document deletes are permanent,
container deletion removes the whole scope and requires owner/admin authority,
and scoped API keys restrict access to a container. The current official
changelog also describes a newer description-based forget flow with dry-run
preview before commit. These guarantees support the stricter model above:
[document deletion](https://supermemory.ai/docs/document-operations),
[container deletion](https://supermemory.ai/docs/api-reference/container-tags/delete-container-tag),
[scoped keys](https://supermemory.ai/docs/authentication), and
[forget/export changelog](https://supermemory.ai/changelog/api/).

If dispatch times out or the response is lost, the result is
`outcome_unknown`. Cabinet must not retry store, delete, migration, export, or
import automatically. It must perform a fresh authoritative reread and require
operator reconciliation.

## Required upstream Hermes patches

1. Add an authenticated machine endpoint such as
   `GET /v1/memory/management` returning the safe projection and explicit
   observation timestamps. It must never include provider contents or secrets.
2. Separate `configured`, local dependency availability, provider loaded,
   initialized, and remotely healthy. Replace prose connection summaries with
   structured redacted codes.
3. Add provider plugin identity: source class, version, immutable manifest/code
   digest, selected profile scope, and tool risk inventory.
4. Add a provider capability interface for metadata-only health, scope class,
   provenance counts, migration, export, and import. Unsupported must be
   explicit, not inferred from missing fields.
5. Replace query deletion with `preview_forget` returning opaque expiring
   preview token, exact match digests/counts, and scope digest; commit must bind
   that token and an idempotency key. Retain exact-ID deletion separately.
6. Add operation receipts and idempotency for store/delete/migrate/export/import,
   canonical before/after fingerprints, server-side approvals, authoritative
   reread, and `outcome_unknown`.
7. Add vendor export/import job metadata contracts. General Hermes backup and
   import must be labeled local-config backup only for Supermemory.
8. Keep `/api/learning/graph` classified as content-bearing local memory.
   Create a separate Supermemory graph capability if desired; never relabel the
   current Starmap as vendor memory.
9. Prefer container-scoped credentials and expose only whether the credential
   is scope-restricted. Never let Cabinet handle raw vendor credentials.
10. Add tests proving no content, queries, results, identifiers, paths, URLs, or
    secret material can cross the management projection.

## Prototype

`experiments/management/memory-supermemory/governed-memory.mjs` implements a
strict metadata projection, recursive sensitive-field rejection, canonical
fingerprints, non-executing action envelopes, typed destructive confirmation,
idempotency requirements, forbidden query deletion, and
`outcome_unknown` reconciliation. It has no Hermes or vendor transport.

No disposable server or port was needed.
