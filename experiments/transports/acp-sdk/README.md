# Persistent Hermes ACP official-SDK probe

This is an isolated research package. It does not integrate with Cabinet
production code or shared dependencies.

The probe uses the stable ACP v1 entry point from
`@agentclientprotocol/sdk@1.3.0`. It owns one Hermes ACP child process and one
SDK connection across multiple turns. It sends no MCP servers, advertises no
file-system or terminal capabilities, forces `HERMES_ACP_NO_TOOLS=1`, rejects
tool and permission events, detects repeated chunks, and validates bounded
newline-delimited frames before passing them to the SDK.

## Safe fixture verification

```sh
npm ci
npm test
npm run fixture
```

The fixture is a disposable local Node process. It does not invoke a model,
Hermes configuration, credentials, network services, or Cabinet data.

## Serialized live acceptance

Do not run this concurrently with another live transport probe. The live mode
refuses to start without `--authorized-live`. It sends exactly the two
authorized prompts, verifies one process and one session across both turns,
then restarts the ACP process and performs a no-model `session/load`.

```sh
HERMES_ACP_COMMAND=/absolute/path/to/cabinet-hermes-companion \
HERMES_ACP_ARGS_JSON='["-p","operator-os","acp"]' \
HERMES_ACP_CWD=/absolute/path/to/experiments/transports/acp-sdk/live-workspace \
npm run live -- --authorized-live
```

The result contains booleans and bounded metrics. It does not print either
prompt or raw protocol traffic.
