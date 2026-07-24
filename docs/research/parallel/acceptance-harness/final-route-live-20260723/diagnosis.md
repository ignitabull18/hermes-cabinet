# Final route live acceptance diagnosis

Verdict: **NOT_ACCEPTED**

The single authorized isolated two-turn conversation run was consumed without
retry. Both turns completed through `ollama-cloud` / `glm-5.2` with one provider
request per turn, zero retries, zero fallbacks, zero tool or permission events,
zero MCP servers, one stable native session, exact 2-user/2-assistant durable
cardinality, and zero pending required writes after completion.

The strict conversation gate failed at checkpoint B because the initial ACP
turn reported `duplicateChunkCount: 1`. Cabinet's ACP client detected two
byte-identical `agent_message_chunk` notifications and suppressed the second
notification before aggregation and persistence. This did not create a
duplicate durable turn or repeat the acceptance nonce, but the production
acceptance contract deliberately requires zero duplicate transport chunks.
The follow-up turn reported zero duplicate chunks.

The initial persisted/rendered byte-equality classification was also false.
That classification is explicitly nonblocking because rendered text may
normalize presentation whitespace; the exact random nonce still appeared once,
was not altered, and remained associated with the same native session. It did
not cause the gate failure.

Because the conversation gate failed, the full route harness and all 15 route
checks remained `NOT_RUN`. No push, PR, merge, deployment, production process,
canonical data, live Hermes configuration, Skill state, credential, or launchd
state was changed.

The minimum next correction is to diagnose why the first live Hermes ACP prompt
emitted an identical assistant chunk twice, then add a regression that proves
one notification per content chunk. A new live run requires separate explicit
authorization.
