# Hermes Skills management contract

Audited 2026-07-21 against Hermes Agent 0.19.0. Hermes remains the canonical
registry and executor. Cabinet holds only bounded in-process previews and
receipts and never claims success without fresh canonical CLI JSON readback.

## Durable interfaces

| Purpose | Exact interface | Authority |
| --- | --- | --- |
| Official catalog | Authenticated `GET /v1/skills?catalog=official` | Discoverability only |
| Canonical installed state | `<approved-cli> -p <profile> skills list --json` | Canonical |
| Exact candidate metadata | `<approved-cli> -p <profile> skills inspect <official-identifier> --json` | Candidate authorization |
| Exact candidate scan | `<approved-cli> -p <profile> skills audit <official-identifier> --json` | Candidate authorization |
| CLI identity | `<approved-cli> version --json`, `hermes.cli.identity` v1 | Executable authority |
| Install | `<approved-cli> -p <profile> skills install <identifier> --yes` | Governed mutation |
| Remove | `<approved-cli> -p <profile> skills uninstall <official-identifier> --yes` | Governed mutation |
| Update | `skills check` only | Audit-only |
| Enable or disable | Interactive `skills config` only | Unsupported; no Cabinet action |

Desktop Management `/api/skills`, `/api/skills/toggle`, and Desktop Hub
search, sources, preview, and scan routes are not dependencies. Agent
`/v1/skills` is never accepted as installed-state proof. Production prepare,
commit precondition, post-dispatch verification, and reconciliation use only
the fixed CLI machine contract.

Every accepted Skills payload is schema v2. It keeps Hub `source`, native
`native_trust`, and Cabinet's derived `authority_class` as separate facts; an
official public target is authorized only when those are exactly `official`,
`builtin`, and `official_public`, with `official`, `public`, and
`local_fulfillment` all true. Schema v1 is rejected.

The official catalog response is bounded to category, exact identifier, name,
source, native trust, and authority facts. Candidate JSON is bounded to exact
identifier and name, official/public/local provenance, native trust,
prerequisite classes, scan verdict, and finding count. Canonical JSON is bounded to profile, exact installed
identity, Hub identifier where applicable, origin/provenance, source, native
trust, authority class, enabled state, exact-match count, and same-name
collision count. Cabinet
rejects extra fields, malformed JSON, ANSI or human table output, schema drift,
profile drift, count disagreement, inspect/audit disagreement, duplicate names,
duplicate identifiers or install paths, stale lock entries, and path mismatch.
There is no last-record-wins normalization.

## Companion revision

The only approved companion is:

- commit: `84b3ed8aace50ca5afb285d299b8a66816085368`
- parent/live installed base: `714ed4ec6cbe3e57b7bb6379c5e97f7b801469a5`
- patch: `docs/evidence/hermes-skills-management/0001-feat-skills-add-governed-machine-contracts-v2.patch`
- patch SHA-256: `e180c1fc84c6de8e26d3de3a13218741068d796049e5c5331fe23f32244f9d1b`

Earlier companions `9172a354f058aa0feaa6ea9c3b7def799e53bada` and
`97f82f73fc15e534fef6377148c99c22be6b652c` are semantic references only and
are not trusted. The live-base commit
`714ed4ec6cbe3e57b7bb6379c5e97f7b801469a5` is the parent, not the approved
management contract.

## Secret-source and execution isolation

Cabinet passes
`HERMES_SKIP_EXTERNAL_SECRET_SOURCES=official-public-skills-v1` only for the
audited public Skills command shapes. The companion extends that allowlist only
for `skills list --json`, `skills inspect official/... --json`, and
`skills audit official/... --json`, exact official install with `--yes`, and
exact official uninstall with `--yes`. Private identifiers and all unrelated
commands remain rejected.

Exact inspect and audit resolve only the local official optional-skill source;
they do not initialize a remote catalog. Cabinet enables the skip only when the
candidate proves official source, builtin native trust, official-public
authority, public and local fulfillment, safe scan
with zero findings, and no credential, account, network, environment, or
command prerequisite. Platform classification alone is non-sensitive.

`CABINET_HERMES_CLI_PATH` has no default. Cabinet requires an absolute regular
executable and binds resolved path, file bytes, device, inode, size,
nanosecond mtime, and machine identity into an opaque authority. It requires
Hermes Agent 0.19.0 and exact source revision
`84b3ed8aace50ca5afb285d299b8a66816085368`. Every subprocess uses
`shell: false`, a fixed argument array, bounded output and deadlines, and a
minimal environment without Cabinet/provider credentials. No `PATH` fallback,
direct Skills file write, human-output parser, or raw CLI output crosses the
adapter boundary.

## Governance and verification

| Property | Behavior |
| --- | --- |
| IDs | Independent cryptographically random 128-bit preview and request identities |
| Actor | Preview and receipt lookup is actor-scoped |
| Binding | Server-only fingerprint covers action, exact target state, profile, source, provenance, and Hub identifier |
| Confirmation | Exact server-issued phrase, for example `INSTALL SKILL one-three-one-rule IN operator-os` |
| Dispatch | At most one fixed CLI mutation for a request; no automatic mutation retry |
| Duplicate commit | Concurrent and later duplicates share the first pending promise or completed result |
| Precondition | Fresh candidate, executable authority, and canonical state must equal prepared state |
| Success | Exact profile, Hub identifier, installed name, official source, builtin native trust, official-public authority, one match, and zero ambiguity |
| Unknown | Timeout, transport loss, or unverified readback becomes `outcome_unknown` |
| Reconciliation | Read-only canonical CLI JSON; never redispatches |
| Rollback | Install names governed Remove; Remove requires a separately confirmed Install |

Install verification requires the exact Hub identifier, installed name,
profile, source, native trust, authority class, official/public/local flags,
and exactly one canonical match. A same-name skill
from another source never verifies. Removal verification requires that no
same-name canonical entry remains, preventing a source collision from being
mistaken for rollback success. CLI exit status alone is never success.

Operational scope is deliberately narrow: Install and exact governed Remove
support official public Hub targets only. Community, GitHub, private, local,
bundled, missing, and ambiguous targets fail closed in both UI projection and
server prepare/commit. Enable and disable are unsupported, and Update remains
audit-only.

Enable and disable are explicitly unsupported because Hermes 0.19.0 exposes no
fixed durable noninteractive mutation for them. They have no production route
action, no supported row action, and no Operator button. Update remains
audit-only.

## Non-egress boundary

Browser responses may contain bounded skill identity, name, installed/enabled
state, safe source/provenance, exact Hub identifier, profile, observation time,
supported action, preview facts, and result state. They never contain actor
identity, fingerprints, credentials, descriptions, skill instructions, prompt
text, manifests, file names, local paths, URLs, raw metadata, raw API/CLI
bodies, executable identity/path, or command arguments.

The acceptance fixture is labeled `Acceptance fixture — no live Hermes
mutation performed`. It exercises the production governance service and route
for Install and Remove only. It cannot expose enable, disable, or update as an
operational action.

## Verification status

The replacement changed surface passes 434/434 tests plus Ruff. Fresh-process
contract loops pass identity 100/100, canonical state 100/100, catalog 50/50,
inspect 50/50, and audit 50/50. Twenty-five unique disposable homes each
completed an exact official install and `uninstall <official-identifier>
--yes` round trip under a deny-network sandbox, with zero 1Password invocation
and an empty canonical lock/install tree afterward.

The identical dev-only full-suite boundary was run against the exact parent and
replacement. The parent completed 2,122 files with 41,252 tests passing and 33
failures; the replacement completed 2,123 files with 43,132 tests passing and
36 failures. Both reproduced the same missing-`acp` import signatures alongside
unrelated macOS/platform/load failures, while the replacement Skills surface
passed. A second complete replacement run used the project-declared `dev` and
`acp` extras (`agent-client-protocol==0.9.0`), eight workers, and a 900-second
file ceiling: all ACP tests passed, and the run completed all 2,123 files with
43,622 tests passing and 30 unrelated macOS/platform failures across 14 files.
The full suite is therefore not claimed as passing.

Cabinet passes 645/645 unit tests, 20/20 focused Skills adapter/governance
tests, TypeScript, full ESLint with zero errors and 110 pre-existing warnings,
the production build, `git diff --check`, and 6/6 isolated rendered workflows.
The rendered checks cover Operator confirmation/result and official-only
Remove projection, all 48 Developer diagnostics, 390x844 reduced motion, zero
horizontal overflow, and zero browser/framework errors.
