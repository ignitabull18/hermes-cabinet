#!/usr/bin/env python3
"""Resolve bounded Hermes model/provider readiness without model dispatch."""

from __future__ import annotations

import json
import os
from urllib.parse import urlparse

from hermes_cli.config import get_config_path, load_config
from hermes_cli.fallback_config import get_fallback_chain
from hermes_cli.runtime_provider import resolve_runtime_provider


def endpoint_class(value: object) -> str:
    raw = value if isinstance(value, str) else ""
    if not raw:
        return "unknown"
    host = (urlparse(raw).hostname or "").lower()
    if host in {"localhost", "127.0.0.1", "::1"}:
        return "local"
    if any(part in host for part in ("proxy", "gateway")):
        return "proxy"
    return "provider"


config = load_config()
model_config = config.get("model")
if isinstance(model_config, dict):
    model = str(model_config.get("default") or model_config.get("model") or "").strip()
    configured_provider = str(model_config.get("provider") or "").strip()
elif isinstance(model_config, str):
    model = model_config.strip()
    configured_provider = ""
else:
    model = ""
    configured_provider = ""

runtime = {}
try:
    runtime = resolve_runtime_provider(requested=configured_provider or None) or {}
except Exception:
    runtime = {}

provider = str(runtime.get("provider") or configured_provider or "").strip()
fallback_models = []
for item in get_fallback_chain(config):
    if isinstance(item, str) and item.strip():
        fallback_models.append(item.strip())
    elif isinstance(item, dict):
        candidate = str(item.get("model") or "").strip()
        if candidate:
            fallback_models.append(candidate)

credential_present = bool(runtime.get("api_key")) or bool(os.environ.get("OLLAMA_API_KEY"))
config_present = get_config_path().is_file()
ready = bool(
    os.environ.get("HERMES_PROFILE", "").strip()
    and provider
    and model
    and credential_present
)

result = {
    "profile": os.environ.get("HERMES_PROFILE", "").strip(),
    "provider": provider,
    "model": model,
    "modelSource": "profile" if model and config_present else "default" if model else "unresolved",
    "credentialState": "present" if credential_present else "absent",
    "endpointClass": endpoint_class(runtime.get("base_url")),
    "fallbackModels": fallback_models,
    "configSource": (
        "explicit_hermes_home"
        if config_present and os.environ.get("HERMES_HOME")
        else "default_hermes_home"
        if config_present
        else "missing"
    ),
    "ready": ready,
    "blockedReason": None if ready else "effective_provider_or_model_unresolved",
}

print(json.dumps(result, separators=(",", ":"), sort_keys=True))
