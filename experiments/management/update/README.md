# Governed Hermes update preview prototype

This isolated prototype models the read/prepare/confirm/reconcile portion of a
future Cabinet update control plane. It is intentionally incapable of applying
an update: it has no process, filesystem, network, service, or restart adapter.

Run:

```sh
npm test
```

The preparation fingerprint binds the installed revision, immutable target,
install method, local-patch summary, machine contract, companion revisions,
side-by-side evidence, restart scope, and rollback target. A future mutation
adapter must re-read native state immediately before dispatch and reject a stale
fingerprint. Once a dispatch may have started, an ambiguous result is
`outcome_unknown`; only reconciliation is allowed until an exact terminal
revision and service state are observed.
