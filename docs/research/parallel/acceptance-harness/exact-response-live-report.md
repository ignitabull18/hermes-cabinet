# Exact-response live acceptance

Verdict: **NOT_ACCEPTED**

The one authorized isolated live two-turn run was consumed without retry. The
initial assistant response was not the exact fixed acceptance token. Raw model
final equality was unavailable; the first live-observable non-exact
representation was the ACP-normalized response, and the initial persisted turn
was also non-exact. This agrees with the static provenance result that the
response diverged before Cabinet persistence.

The follow-up persisted value was exact, but both ACP equality observations
were false. The live page's message-body selector resolved zero elements for
both turns, so rendered equality could not be established. That selector
failure masked the earlier ACP/persistence mismatch in the top-level error; it
does not move the first divergence downstream. Per the stop contract, no
further live run was made.

## Content-free equality ledger

| Turn | Raw model | ACP normalized | Persisted | Rendered body | Harness extraction | Body elements |
| --- | --- | --- | --- | --- | --- | --- |
| Initial | unavailable | non-exact | non-exact | not established | non-exact | 0 |
| Follow-up | unavailable | non-exact | exact | not established | exact | 0 |

## Preserved invariants

- Provider/model: `ollama-cloud` / `glm-5.2`
- Provider requests: 2 total, exactly 1 per turn
- Provider retries and fallbacks: 0
- Native session identity: stable
- Final cardinality: 2 user turns, 2 completed assistant turns, 4 total
- Duplicate turn identities: 0
- Required writes pending after each completed persistence barrier: 0
- Cabinet restarts completed: 2
- Consequential Hermes mutations: 0
- Production touched: no

## Withheld authoritative harness

All 15 routes, the full desktop workflow, and the full mobile workflow are
`NOT_RUN`. The exact gate failed first, so the harness made no additional
conversation or model request. No draft PR was opened.

## Safety

The preserved artifact contains no secret indicators, local-path indicators,
or conversation content. A local process-status diagnostic during coordination
unexpectedly rendered inherited environment values in transient tool output.
No value was written to repository evidence, sent to an external system, or
mutated; credentials and configuration were left untouched.
