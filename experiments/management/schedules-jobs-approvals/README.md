# Schedules, jobs, runs, approvals, and queues governance prototype

This dependency-free fixture demonstrates a Cabinet-side governance seam without
calling Hermes or changing local services. It deliberately separates cron
schedules and durable execution history from Agent API runs, TUI pending inputs,
and Kanban workers.

The coordinator:

- fingerprints the exact target read before dispatch;
- requires a typed confirmation bound to the action, target, and plan;
- dispatches at most once per idempotency key;
- verifies the postcondition from a new read;
- reports `outcome_unknown` when dispatch cannot be proven;
- never retries an ambiguous write;
- omits prompt, answer, command, and queue content from plans and receipts.

The fixture covers schedule create, update, pause, resume, trigger, and delete,
plus exact clarification response. Approval actions are rejected because
current Hermes approval responders target
the oldest pending approval in a session (or all pending approvals), not an
immutable approval request ID. Run retry and resume are unsupported. Run
termination is disabled by this stream; only its exact terminal-state verifier
is modeled.

Run:

```sh
npm test
```
