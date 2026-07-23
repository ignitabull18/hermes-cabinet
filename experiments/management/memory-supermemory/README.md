# Governed memory-management contract prototype

This disposable, standard-library-only prototype models two things:

1. a metadata-only projection that rejects memory contents, search queries,
   profile facts, raw scope identifiers, and credentials; and
2. non-executing mutation envelopes with exact fingerprints, typed
   confirmation for destructive operations, idempotency requirements, no
   automatic retries, and explicit `outcome_unknown` reconciliation.

It does not import Hermes, inspect configuration or secrets, contact
Supermemory, read memory files, or implement any mutation transport.

Run:

```sh
node --test experiments/management/memory-supermemory/governed-memory.test.mjs
```
