# HTTP/SSE transport probe

This probe imports the exact installed Hermes source and starts only its
`APIServerAdapter`. It never launches `hermes gateway`, a dispatcher, a
webhook adapter, launchd, or the desktop management server.

The fixture command binds only `127.0.0.1:4203`, uses a temporary
`HERMES_HOME`, and substitutes a deterministic no-tools agent:

```bash
HERMES_SOURCE="$HOME/.hermes/hermes-agent" \
  "$HOME/.hermes/hermes-agent/venv/bin/python" \
  experiments/transports/http-sse/probe.py fixture
```

The live command is deliberately fail-closed. It requires an isolated Hermes
home outside the canonical profile tree with the shape
`<isolated-root>/profiles/operator-os`, a marker file named
`.cabinet-http-sse-profile` containing `operator-os`, no `.env` file in that
home, a strong caller bearer token, port 4203, and loopback binding. It forces
the constructed `AIAgent` to expose zero tools and aborts if that invariant
does not hold.

The isolated `config.yaml` must contain only these nonsecret fields:

```yaml
model:
  default: "<acceptance model id>"
  provider: "<environment-authenticated provider id>"
  # base_url: "<optional nonsecret endpoint>"
platform_toolsets:
  api_server: []
mcp_servers: {}
```

Provider authentication may be inherited from a provider-specific environment
variable that the overseer shell already exports and Hermes normally supports.
The probe does not retrieve, copy, persist, or print that credential. If no
such environment-only credential is already present, live acceptance is
blocked; do not copy an OAuth/auth file or a production profile `.env` into the
isolated home.

Do not run live mode until the overseer serializes it after the ACP and TUI
Gateway measurements.
