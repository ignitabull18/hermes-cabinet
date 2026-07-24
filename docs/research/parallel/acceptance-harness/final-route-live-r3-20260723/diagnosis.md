# Final-route live acceptance r3 diagnosis

## Verdict

`NOT_ACCEPTED`

The single authorized run was consumed without retry. The live conversation
contract passed:

- one stable native session across two required Cabinet restarts;
- exactly two user and two completed assistant turns;
- the fresh nonce appeared exactly once in each response;
- zero provider retries, fallbacks, tools, decisions, duplicate chunks, or MCP
  servers;
- zero pending required writes after each completed turn.

The full route harness also exercised all 15 required routes successfully,
including direct conversation reload, history navigation, controlled restart,
desktop, mobile, and reduced motion.

## Only failed check

`console-health` recorded one issue during `history-navigation`:

> Hermes health returned an unreadable projection.

The response observer awaits `response.finished()`, reads `response.body()`,
and parses JSON inside one `try` block. Any exception from those three
operations becomes the same unreadable-projection issue. The preserved result
therefore does not prove that the server returned malformed health JSON.

The likely cause is an observation race: browser history navigation invalidated
or evicted the completed response body before the asynchronous observer read
it. This is an inference from the handler and stage ownership, not a confirmed
server-side failure.

## Safety

- Production touched: no.
- Consequential Hermes mutations: 0.
- Secret or local-path indicators retained: 0.
- Retry, additional model request, push, PR, merge, or deployment: none.

No harness correction was made because this run authorized acceptance only.
