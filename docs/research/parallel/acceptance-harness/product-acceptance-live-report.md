# Product-valid conversation acceptance

Verdict: **NOT_ACCEPTED**

The one authorized isolated live run was consumed without retry. Both assistant
responses contained the fresh acceptance nonce exactly once. Surrounding
operator formatting was present and permitted. The same native Hermes session
survived two Cabinet restarts, final durable cardinality remained exactly two
user and two completed assistant turns, and required writes were drained.

Provider accounting was `ollama-cloud` / `glm-5.2`, two model requests, zero
provider retries, zero fallbacks, zero tool events, zero permission-decision
events, zero duplicate chunks, and zero MCP servers.

The run stopped because the harness asserted the optional
conversation-detail pending-write field, which was `null`, instead of the
authoritative acceptance-observability value, which was `0` after the initial
turn, follow-up, and second restart. The binding is corrected offline, but the
live run is not retried. All production routes remain `NOT_RUN`, no draft PR is
opened, and production remains untouched.

Natural-language exact-output requests are not guaranteed byte-for-byte across
all configured models. A future constrained-output contract is required for
strict machine output.
