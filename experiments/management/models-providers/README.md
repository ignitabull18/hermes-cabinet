# Models/providers governed-preview prototype

This isolated package models Cabinet's prepare/confirm/commit/readback contract
without importing Cabinet, starting Hermes, reading live configuration, or
performing a real mutation.

Run:

```sh
npm test
```

`PreviewOnlyCoordinator` accepts injected fixture functions only. It contains no
HTTP client, filesystem writer, process spawning, environment loading, or secret
handling.
