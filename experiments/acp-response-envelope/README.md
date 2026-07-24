# ACP response-envelope provenance experiment

This diagnostic reproduces the measured envelope property with a deterministic
fixture and no provider call. It verifies that the ACP-to-harness text path is
lossless except for boundary whitespace trimming and therefore cannot introduce
operator-report prose.

Run:

```sh
node --test experiments/acp-response-envelope/trace.test.mjs
```

The synthetic fixture is not a reconstruction of the discarded live response
bytes. It contains only the fixed acceptance token and generic report labels
needed to exercise prefix, suffix, and structured-envelope detection.

