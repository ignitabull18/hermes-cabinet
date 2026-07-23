# ACP provider/model differential

This experiment compares the provider/model inputs used by the accepted
standalone ACP probe with the failed integrated Cabinet run. It is diagnostic
only and does not import or modify Cabinet production code.

The readiness probe resolves configuration, provider metadata, and fallback
metadata without initializing ACP, creating a session, dispatching a prompt,
or contacting a model provider. Source and interpreter locations are supplied
through process environment variables and are never written to its output.

Run the fixture tests:

```sh
node --test experiments/acp-provider-model-differential/*.test.mjs
```

Run the single bounded readiness diagnostic:

```sh
PASSING_SOURCE_ROOT=/absolute/source/root \
PASSING_PYTHON=/absolute/python \
FAILING_SOURCE_ROOT=/absolute/source/root \
FAILING_PYTHON=/absolute/python \
node experiments/acp-provider-model-differential/run-readiness-diagnostic.mjs
```

The diagnostic uses an isolated temporary home and a non-secret presence
marker. It stops after local provider/model resolution.
