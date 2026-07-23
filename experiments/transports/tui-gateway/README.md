# TUI Gateway JSON-RPC probe

This experiment wraps the installed Hermes `tui_gateway.ws.handle_ws` mount in
a disposable listener fixed to `127.0.0.1:4202`. It does not start, stop, or
contact any existing Hermes gateway job.

Static and isolated socket-fixture tests:

```bash
python3 -m unittest discover -s experiments/transports/tui-gateway/tests -v
TUI_GATEWAY_FIXTURE_E2E=1 \
  /Users/ignitabull/.hermes/hermes-agent/venv/bin/python \
  -m unittest discover -s experiments/transports/tui-gateway/tests -v
```

The guarded live acceptance command is recorded in the research report. Do not
run it concurrently with another transport acceptance.
