# Production acceptance harness

Verdict: **NOT_ACCEPTED**

The runner exercised an isolated application build on port 4354. It sent 2 bounded live model message request(s) and did not touch production or canonical data.

## Checks

| Area | Check | Status | Result |
| --- | --- | --- | --- |
| conversation | live-two-turn-contract | FAILED | Two-turn provider gate failed: Error: checkpoint B provider or no-tools accounting is invalid |
| routes | full-route-harness | NOT_RUN | NOT_RUN because the two-turn provider gate did not pass; no additional conversation or model call was made. |

## Exact blockers

- `live-two-turn-contract-failed`: Two-turn provider gate failed: Error: checkpoint B provider or no-tools accounting is invalid

## Accounting

- Exact nonce present: initial=true, follow-up=true
- Nonce occurrence count: initial=1, follow-up=1
- Surrounding formatting present: initial=true, follow-up=true
- Altered or partial nonce present: initial=false, follow-up=false
- Persisted content matches rendered content: initial=false, follow-up=true
- Session context preserved: initial=true, follow-up=true
- Message-body selector: [data-testid="turn"][data-turn-role="agent"] > [data-testid="assistant-message-content"][data-message-author="assistant"][data-message-part="content"]
- Message-body element count: 2
- Requests: 59
- Mutations observed: 2
- Legacy daemon-output requests: 0
- Search requests: 0
- PTY create/write requests: 0
- Model message requests: 2
- Provider identities observed: ollama-cloud
- Effective model identities observed: glm-5.2
- Provider requests attempted: 2
- Provider retries: 0
- Fallback attempts: 0
- Tool events: 0
- Decision events: 0
- Duplicate chunks: 1
- MCP servers: 0
- Pending required writes ledger: [{"checkpoint":"A","pendingRequiredWrites":{"state":"unknown","value":null,"source":"acceptance_observability","reason":"authoritative_absent"}},{"checkpoint":"B","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"C","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"D","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"E","pendingRequiredWrites":{"state":"known","value":1,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"F","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"G","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}},{"checkpoint":"H","pendingRequiredWrites":{"state":"known","value":0,"source":"acceptance_observability","legacyState":"absent"}}]
- Consequential Hermes mutations: 0
- Relevant browser issues: 0
- Developer diagnostics observed: not observed
- Secret indicators: 0
- Local-path indicators: 0

## Recommendation

Resolve only the exact blockers above, then rerun the same bounded acceptance.

## Known limitation

Natural-language exact-output requests are not guaranteed byte-for-byte across all configured models. A future constrained-output contract is required for strict machine output.
