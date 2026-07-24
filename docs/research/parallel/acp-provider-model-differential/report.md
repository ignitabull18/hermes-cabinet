# ACP provider/model resolution differential

## Verdict

The first divergence was the process configuration root, before ACP session
creation. Cabinet did not send a model or provider override, and browser state
could not introduce one in Hermes mode.

The passing standalone path used the pinned no-tools companion wrapper. That
wrapper selected the disposable Hermes configuration root containing profile
`operator-os`, provider adapter `ollama-cloud`, and model `glm-5.2`.

The failed integrated path selected a direct `hermes-acp` entry point. Cabinet
passed `HOME`, `HERMES_PROFILE`, `HERMES_ACP_NO_TOOLS`, and the credential key
name, but not `HERMES_HOME`. The acceptance fixture wrote its provider/model
configuration under the companion-specific root. Direct Hermes therefore
loaded its default home, found no configured model, and its ACP session factory
passed an explicit empty string to `AIAgent`.

The single bounded readiness diagnostic reproduced that exact split before ACP
initialization. With the explicit companion configuration root, readiness was
true for `operator-os`, `ollama-cloud`, and `glm-5.2`. With the integrated
environment shape, the provider and credential presence still resolved, but
the configuration source and model were missing and readiness was false. The
diagnostic recorded zero prompts, model requests, and provider completions.

## Exact inspected revisions

| Component | Revision |
| --- | --- |
| Cabinet integration | `3cf7f7ccf122df61a9a08370c9cc1a9ce65c60b3` |
| Passing no-tools companion | `8a0564d9bc5560879ff432dc753ee560f969b370` |
| Direct installed Hermes source used for the failing environment reproduction | `55759cb2737cd3870f9de4693f66fa38eaf0dd2b` |

Only executable and source identity metadata was inspected. No environment
value, endpoint, credential, or local path was retained.

## Ownership

| Fact | Owner |
| --- | --- |
| Empty effective model | Hermes ACP `SessionManager`, after the launch supplied the wrong configuration root |
| HTTP 404 | The selected provider endpoint, reached through the Ollama Cloud adapter |
| Three attempts | Hermes application-level conversation loop |
| No fallback | The isolated acceptance configuration contained no fallback chain |

Hermes disables SDK-level retries for the provider call and then applies its
own bounded application loop. The empty-model 404 text placed quotes between
`model` and `not found`; the classifier's unquoted substring did not match, so
the deterministic rejection was treated as retryable unknown. No fallback
changed provider or model.

## Required differential

| Field | Passing standalone | Failing integrated | Same? |
| --- | --- | --- | --- |
| Cabinet model field | Omitted | Omitted | Yes |
| Cabinet provider field | Omitted | Omitted | Yes |
| Browser override influence | None | Discarded by Hermes-mode normalization | Yes |
| ACP new/load model override | Omitted | Omitted | Yes |
| Profile | `operator-os` | `operator-os` | Yes |
| Client capabilities | Filesystem false, terminal false | Filesystem false, terminal false | Yes |
| MCP servers | Empty | Empty | Yes |
| Executable class | Pinned no-tools wrapper | Direct `hermes-acp` | No |
| Hermes configuration root | Explicit companion root | Default root; fixture configuration elsewhere | No |
| Effective provider | `ollama-cloud` | `ollama-cloud` | Yes |
| Effective model | `glm-5.2` | Empty | No |
| Endpoint class | Provider | Provider | Yes |
| Provider attempts | One | Three | No |
| Fallback attempts | Zero | Zero | Yes |

## Minimum correction

Use one strict environment builder and one provider/model resolver for both
standalone and Cabinet launches. Bind the exact executable identity and the
same explicit Hermes configuration-root classification. Before ACP session
creation or prompt dispatch, require a valid readiness record with nonempty
profile, provider, and model. Unknown models must remain omitted, never
serialized as an empty override.

An empty model must fail locally without a provider request or retry. A
provider 404 must remain distinct from ACP transport failure and expose bounded
attempt, retry, and fallback counts.

## Safety and scope

The diagnostic stopped after local configuration and provider metadata
resolution. It performed zero ACP prompts, model requests, provider
completions, tools, external communications, or mutations. It did not modify
Hermes, Cabinet production, profiles, credentials, services, launchd, or
provider/model configuration.
