# ACP restart persistence event-trace forensics

## Decision

The measured failure is a product atomicity bug exposed by a correct harness
requirement. It is not ACP session replay and it is not Git/history lag.

The follow-up user turn becomes visible before the conversation lifecycle is
atomically changed from the prior turn's `completed` state to `running`.
Therefore a concurrent detail read can observe:

- two durable user turns;
- one durable assistant turn;
- the old public `completed` state;
- one causally pending follow-up operation;
- no second ACP prompt dispatch yet.

The acceptance wait treats that stale `completed` state as follow-up
completion and immediately performs its exact assistant cardinality check.
That produces the demonstrated `2 user / 1 assistant` failure.

## Bounded A-H ledger

The committed machine ledger is `ledger.json`. It contains identities,
request epochs, roles, lifecycle states, sequence numbers, event types, counts,
timestamps, and fixed-token classifications only.

| Checkpoint | Public state | User | Assistant | Pending assistant | Native session | Causally pending |
|---|---:|---:|---:|---:|---:|---:|
| A | none | 0 | 0 | 0 | 0 | 0 |
| B | completed | 1 | 1 | 0 | 1 | 0 |
| C | completed | 1 | 1 | 0 | 1 | 0 |
| D | completed | 1 | 1 | 0 | 1 | 0 |
| E | completed (stale) | 2 | 1 | 0 | 1 | 1 |
| F | completed (premature) | 2 | 1 | 0 | 1 | 1 |
| G | completed (causal) | 2 | 2 | 0 | 1 | 0 |
| H | completed | 2 | 2 | 0 | 1 | 0 |

At G and H there is exactly one Cabinet conversation, two users, two finalized
assistants, one unchanged native session, zero duplicate turns, and zero
pending required work.

## First divergence and exact event

The first divergence is E. `appendUserTurn()` writes the turn file before it
writes the updated conversation metadata. The turn file write is therefore
observable while `meta.status` still carries the preceding turn's
`completed` value.

The trace captured E and the externally accepted F state before process 2's
request 2 existed. The second ACP prompt was dispatched later, loaded the same
native session with zero replay notifications, and eventually finalized the
second assistant at G.

This also explains why the earlier harness reported follow-up completion and
then found only one assistant. The public completion belonged to the previous
turn, not the accepted follow-up.

## Boundary findings

- User-turn append: non-atomic turn-file then meta transition. This is the
  root divergence.
- Pending-assistant creation: occurs after prompt/context preparation, leaving
  a real window in which the second user is visible but no second assistant
  placeholder exists.
- ACP prompt dispatch: two process-scoped request epochs were observed.
- ACP load/replay: one `session.load`, identity equal, zero history
  notifications.
- Assistant chunk/finalization: one unique fixed-token chunk and one terminal
  result per prompt. The second assistant settled in place; no old assistant
  was overwritten.
- Session persistence: one unchanged identity at B through H.
- Store drain: G and H show zero causally pending operations and exact `2/2`.
- Git/history: no cardinality change occurred between the causal drain and the
  second restart. It is not the cause.
- External completion: status alone is not prompt-epoch scoped and can describe
  the previous turn during the follow-up append window.

## Minimum correction

Commit acceptance of a user follow-up and the lifecycle transition as one
serialized store operation. A detail reader must never observe the new user
turn with the previous turn's terminal status.

Completion must also be correlated with the accepted follow-up's stable
server-owned turn/request identity and published only after its assistant
finalization, session persistence, canonical turn persistence, and required
store barrier complete. The harness should preserve its ledger before
assertions, but it must not weaken exact `2/2`.

No production application code was changed in this stream.
