# ACP response-envelope provenance

## Result

The first evidenced divergence is `raw_acp_assistant_content_blocks`. The
retained live artifact proves that the persisted assistant turn was not exactly
`CABINET_ACCEPTANCE_OK`, while source tracing proves that every layer from the
Hermes ACP assistant block through Cabinet's harness preserves the assistant
text, apart from boundary whitespace trimming. None of those layers can add the
operator-report envelope.

The raw provider/model final was deliberately not retained, so
`raw_model_exact` is `null`. The bounded owner is the pre-ACP Hermes
response-generation layer: the selected `operator-os` profile supplies broad
default report-format instructions without an explicit-output exception. ACP
emits Hermes `final_response` or its streamed deltas as text without adding
that format. This report does not claim the discarded live wrapper's exact
bytes.

## Effective inputs

| Input | Accepted-run evidence |
| --- | --- |
| User constraint | Exact fixed-token request |
| Profile | `operator-os` |
| Provider / model | `ollama-cloud` / `glm-5.2` |
| Session options | Persistent ACP, no tools, zero MCP servers |
| Profile instruction class | Default operator run-report formatting |
| Active Skill identities | Not retained in the sanitized artifact |
| `one-three-one-rule` activation | No evidence of activation in this run; no Skill/tool event was emitted |
| Cabinet-added response-format instruction | None found |

## Equality ledger

The yes/no columns describe the safely reproducible operator-envelope fixture.
For the actual run, only non-exactness and the structured operator envelope were
retained; its exact prefix and suffix bytes were discarded.

| Layer | Exact token | Prefix | Suffix | Structured envelope | Metadata inside body |
| --- | --- | --- | --- | --- | --- |
| Raw model final | unknown | unknown | unknown | unknown | unknown |
| Raw ACP assistant content blocks | no | yes | yes | yes | no |
| Official SDK normalized notifications | no | yes | yes | yes | no |
| Shared ACP transport-core chunks | no | yes | yes | yes | no |
| Final Hermes adapter result | no | yes | yes | yes | no |
| Persisted Cabinet assistant turn | no | yes | yes | yes | no |
| Conversation detail API response | no | yes | yes | yes | no |
| Rendered assistant-message body | no | yes | yes | yes | no |
| Harness extraction | no | yes | yes | yes | no |

The rendered row is source-contract and fixture evidence, not a claim that the
withheld full browser harness rendered the failed live turn. The live provider
gate extracted the persisted detail response directly.

## Layer ownership

1. Hermes' ACP server forwards stream deltas and `final_response` through
   `update_agent_message_text` without adding an envelope.
2. The official TypeScript SDK notification handler exposes the text block
   unchanged.
3. Cabinet's shared ACP client concatenates only `update.content.text`.
4. The Hermes adapter returns that output unchanged.
5. Conversation finalization may trim terminal framing and Cabinet control
   blocks; it has no operator-report formatter.
6. The detail route serializes the stored turn unchanged.
7. The assistant message viewer receives only `turn.content`.
8. The acceptance provider gate reads `turn.content.trim()` and asserts strict
   equality. It does not use a larger DOM container.

Therefore ACP normalization, Cabinet persistence, detail serialization, UI
rendering, and harness extraction are excluded as envelope owners. The minimum
single-layer correction is to make default `operator-os` report formatting
yield to explicit user output constraints before the model-facing request is
completed. Post-processing, token extraction, and relaxed assertions are not
valid fixes.

## Safe verification

- Cabinet base: `6178270d7276418e04c78b6eff14285d2b622fc2`
- Hermes companion source reviewed: `ad7fff50a72c4534cdcc7a34b99c19344b2459a5`
- Provider/model calls: 0
- Tools or consequential mutations: 0
- Fixed-token fixture only; no unrelated conversation content retained

