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
| Remove | `<approved-cli> -p <profile> skills uninstall <name>` | Governed mutation |
| Update | `skills check` only | Audit-only |
| Enable or disable | Interactive `skills config` only | Unsupported; no Cabinet action |

Desktop Management `/api/skills`, `/api/skills/toggle`, and Desktop Hub
search, sources, preview, and scan routes are not dependencies. Agent
`/v1/skills` is never accepted as installed-state proof. Production prepare,
commit precondition, post-dispatch verification, and reconciliation use only
the fixed CLI machine contract.

The official catalog response is bounded to category, exact identifier, name,
source, and trust. Candidate JSON is bounded to exact identifier and name,
official/public/local provenance, trust, prerequisite classes, scan verdict,
and finding count. Canonical JSON is bounded to profile, exact installed
identity, Hub identifier where applicable, origin/provenance, source/trust,
enabled state, exact-match count, and same-name collision count. Cabinet
rejects extra fields, malformed JSON, ANSI or human table output, schema drift,
profile drift, count disagreement, and inspect/audit disagreement.

## Companion revision

The only approved companion is:

- commit: `97f82f73fc15e534fef6377148c99c22be6b652c`
- parent/live installed base: `714ed4ec6cbe3e57b7bb6379c5e97f7b801469a5`
- patch: `docs/evidence/hermes-skills-management/0001-feat-skills-expose-canonical-machine-contracts.patch`
- patch SHA-256: `87c4bcec83050f1452bb3ee80372d61f9932b0bbb5fbecce8987d04ab675237b`

Earlier companion `9172a354f058aa0feaa6ea9c3b7def799e53bada` is a semantic
reference only and is not trusted. The live-base commit
`714ed4ec6cbe3e57b7bb6379c5e97f7b801469a5` is the parent, not the approved
management contract.

## Secret-source and execution isolation

Cabinet passes
`HERMES_SKIP_EXTERNAL_SECRET_SOURCES=official-public-skills-v1` only for the
audited public Skills command shapes. The companion extends that allowlist only
for `skills list --json`, `skills inspect official/... --json`, and
`skills audit official/... --json`. Private identifiers and all unrelated
commands remain rejected.

Exact inspect and audit resolve only the local official optional-skill source;
they do not initialize a remote catalog. Cabinet enables the skip only when the
candidate proves official source/trust, public and local fulfillment, safe scan
with zero findings, and no credential, account, network, environment, or
command prerequisite. Platform classification alone is non-sensitive.

`CABINET_HERMES_CLI_PATH` has no default. Cabinet requires an absolute regular
executable and binds resolved path, file bytes, device, inode, size,
nanosecond mtime, and machine identity into an opaque authority. It requires
Hermes Agent 0.19.0 and exact source revision
`97f82f73fc15e534fef6377148c99c22be6b652c`. Every subprocess uses
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
| Success | Exact profile, Hub identifier, installed name, official provenance, one match, and no same-name collision |
| Unknown | Timeout, transport loss, or unverified readback becomes `outcome_unknown` |
| Reconciliation | Read-only canonical CLI JSON; never redispatches |
| Rollback | Install names governed Remove; Remove requires a separately confirmed Install |

Install verification requires the exact Hub identifier, installed name,
profile, source, provenance, and exactly one canonical match. A same-name skill
from another source never verifies. Removal verification requires that no
same-name canonical entry remains, preventing a source collision from being
mistaken for rollback success. CLI exit status alone is never success.

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
