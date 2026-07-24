# Final route live acceptance diagnosis

Verdict: **NOT_ACCEPTED**

The single authorized isolated two-turn conversation run was consumed without
retry. Both turns completed through `ollama-cloud` / `glm-5.2` with one provider
request per turn, zero retries, zero fallbacks, zero tool or permission events,
zero MCP servers, one stable native session, exact 2-user/2-assistant durable
cardinality, and zero pending required writes after completion.

The strict conversation gate failed at checkpoint B because the initial ACP
turn reported `duplicateChunkCount: 1`. A subsequent source audit proved that
this counter did not establish a duplicate transport notification. Cabinet was
classifying any repeated message-ID-less text chunk as a duplicate by comparing
the complete update payload. ACP defines chunks as ordered append operations,
so two equal text chunks can be legitimate content. The client then suppressed
the second chunk before aggregation and persistence. This did not create a
duplicate durable turn or repeat the acceptance nonce. The follow-up turn
reported zero duplicate chunks.

The initial persisted/rendered byte-equality classification was also false.
That classification is explicitly nonblocking because rendered text may
normalize presentation whitespace; the exact random nonce still appeared once,
was not altered, and remained associated with the same native session. It did
not cause the gate failure.

Because the conversation gate failed, the full route harness and all 15 route
checks remained `NOT_RUN`. No push, PR, merge, deployment, production process,
canonical data, live Hermes configuration, Skill state, credential, or launchd
state was changed.

The minimum correction is in Cabinet's ACP client: preserve all ordered chunks
from the active prompt and classify only a chunk carrying a message identity
that was already completed by an earlier prompt as stale/duplicate. The
regression must prove that equal text chunks append twice while a late prior
message identity is still ignored and counted. A new live run requires separate
explicit authorization.
