# Governed plugin and MCP action envelopes

This is a preview-only reference implementation for Cabinet. It does not call
Hermes, execute commands, mutate configuration, read credentials, or restart a
runtime.

The prototype demonstrates four controls that the native Hermes management
surfaces do not currently combine:

1. an exact profile-scoped Hermes snapshot fingerprint;
2. content and tool allowlists before activation;
3. a canonical reread immediately before any mutation;
4. post-action reconciliation with `outcome_unknown` and no automatic retry.

Run the isolated tests with:

```sh
node --test experiments/management/plugins-mcp/governed-actions.test.mjs
```

`authorizeAfterCanonicalReread()` deliberately returns no mutation instruction.
Production wiring remains blocked until Hermes exposes stronger canonical
identity, version, compare-and-swap, provenance, and rollback contracts.
