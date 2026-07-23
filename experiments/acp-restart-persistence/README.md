# ACP restart persistence trace

This experiment drives the real Cabinet HTTP conversation surface against a
synthetic ACP child. It uses isolated Cabinet data, a temporary home directory,
and port 4311. It never invokes a model or Hermes.

The child records only protocol identities, request ordinals, lifecycle event
types, sequence numbers, and fixed-token classifications. The runner captures
checkpoints A through H and removes its temporary state on exit.

Run after a production build:

```sh
npm run build
node experiments/acp-restart-persistence/run-trace.mjs
```

Use `--follow-up-delay-ms=0` for the fast control. The default 3500 ms delay
models a normal non-instant follow-up and exposes any premature public
completion. `--output=<repo-relative-path>` also writes the content-free ledger
to a chosen evidence file.
