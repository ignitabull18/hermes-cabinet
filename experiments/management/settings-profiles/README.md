# Settings and profiles governance experiment

This dependency-free prototype models Cabinet's governance envelope around
Hermes-native settings and profile operations. It does not connect to Hermes,
read profile files, inspect secret values, or mutate a service.

Run:

```bash
node --test experiments/management/settings-profiles/contract.test.mjs
```

The core sequence is:

1. `readState()` accepts an already-sanitized native projection and creates a
   deterministic revision.
2. `prepareChange()` rejects stale state, predicts the exact canonical result,
   produces a bounded diff and generates a typed confirmation phrase.
3. `DispatchLedger.dispatch()` permits one native dispatch for a dispatch key.
4. A fresh canonical reread determines `verified`, `not_applied`, or `diverged`.
5. Rollback is described but never automatic; it must be prepared as a new
   governed operation from a fresh read.
