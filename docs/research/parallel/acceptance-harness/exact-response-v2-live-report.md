# Exact-response v2 live acceptance

Verdict: **NOT_ACCEPTED**

The one authorized isolated live two-turn run was consumed without retry. The
initial assistant response was not the exact required response. Raw model final
equality was unavailable; the first live-observable non-exact representation
was the ACP-normalized response, and the initial persisted turn was also
non-exact. The already-tested prompt-precedence companion was the active ACP
toolchain, but it did not produce live exact-response fidelity for the initial
turn.

The assistant-content boundary defect is resolved. The stable production
selector resolved exactly two elements after the asynchronous task-detail load.
The follow-up persisted, rendered message-body, and harness-extracted values
were exact. No container metadata was treated as assistant content.

## Content-free equality ledger

| Turn | Raw model | ACP normalized | Persisted | Rendered body | Harness extraction | Body elements |
| --- | --- | --- | --- | --- | --- | --- |
| Initial | unavailable | non-exact | non-exact | non-exact | non-exact | 2 |
| Follow-up | unavailable | non-exact | exact | exact | exact | 2 |

## Preserved invariants

- Provider/model: `ollama-cloud` / `glm-5.2`
- Provider requests: 2 total, exactly 1 per turn
- Provider retries and fallbacks: 0
- Native session identity: stable
- Final cardinality: 2 user turns, 2 completed assistant turns, 4 total
- Duplicate turn identities: 0
- Required writes pending after completed persistence barriers: 0
- Cabinet restarts completed: 2
- Consequential Hermes mutations: 0
- Production touched: no

## Withheld authoritative harness

All 15 routes, the full desktop workflow, and the full mobile workflow are
`NOT_RUN`. The exact gate failed first, so the harness made no additional
conversation or model request. No draft PR was opened.

## Safety

The preserved artifact contains no secret indicators, local-path indicators,
or conversation content. Credentials were injected without display and were
not rotated. Live Hermes, its checkout and venv, production Cabinet, canonical
data, Skills, launchd, remotes, and deployments were not modified.

The isolated onboarding UI rendered its temporary data location in transient
Browser tool output during preflight. That value was not retained in repository
evidence or sent externally.
