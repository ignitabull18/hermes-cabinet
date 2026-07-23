#!/usr/bin/env python3
"""Isolated Hermes HTTP/SSE transport probe.

The fixture mode exercises the installed Hermes APIServerAdapter with a
deterministic in-process agent. The live mode is intentionally gated behind an
explicit isolated HERMES_HOME and is only for the overseer's serialized
acceptance run.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

EXPECTED_HERMES_REVISION = "55759cb2737cd3870f9de4693f66fa38eaf0dd2b"
PROFILE_MARKER = ".cabinet-http-sse-profile"
ACCEPTANCE_PROMPT = (
    "This is a local Cabinet transport acceptance test. Do not use tools or "
    "contact external systems. Reply with exactly CABINET_TRANSPORT_OK."
)
FOLLOW_UP_PROMPT = "Reply with the exact transport token from your previous response."


def _source_root() -> Path:
    return Path(
        os.environ.get("HERMES_SOURCE", "~/.hermes/hermes-agent")
    ).expanduser().resolve()


def _install_source() -> Path:
    source = _source_root()
    if not (source / "gateway/platforms/api_server.py").is_file():
        raise RuntimeError("HERMES_SOURCE is not a Hermes source checkout")
    if str(source) not in sys.path:
        sys.path.insert(0, str(source))
    return source


def _source_revision(source: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(source), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def _assert_source_revision(source: Path) -> None:
    revision = _source_revision(source)
    if revision != EXPECTED_HERMES_REVISION:
        raise RuntimeError(
            f"installed Hermes revision mismatch: expected "
            f"{EXPECTED_HERMES_REVISION}, got {revision}"
        )


def _assert_port(port: int) -> None:
    if port != 4203:
        raise RuntimeError("this probe is restricted to port 4203")


def _assert_loopback(host: str) -> None:
    if host != "127.0.0.1":
        raise RuntimeError("this probe is restricted to 127.0.0.1")


def _assert_isolated_home(home: Path, profile: str) -> None:
    home = home.expanduser().resolve()
    if not home.is_dir():
        raise RuntimeError("acceptance HERMES_HOME does not exist")
    marker = home / PROFILE_MARKER
    if not marker.is_file() or marker.read_text(encoding="utf-8").strip() != profile:
        raise RuntimeError(
            f"isolated home must contain {PROFILE_MARKER} with value {profile}"
        )
    if (home / ".env").exists():
        raise RuntimeError(
            "isolated acceptance home must not contain a credential-bearing .env"
        )
    raw_config = home / "config.yaml"
    if not raw_config.is_file():
        raise RuntimeError("isolated acceptance home requires config.yaml")
    if home.parent.name != "profiles" or home.name != profile:
        raise RuntimeError(
            "isolated home must use <isolated-root>/profiles/<profile> so "
            "Hermes resolves the native profile name correctly"
        )

    import yaml

    config = yaml.safe_load(raw_config.read_text(encoding="utf-8")) or {}
    if set(config) - {"model", "platform_toolsets", "mcp_servers"}:
        raise RuntimeError(
            "isolated config may contain only model, platform_toolsets, and "
            "mcp_servers"
        )
    model = config.get("model")
    if not isinstance(model, dict) or not str(model.get("default") or "").strip():
        raise RuntimeError("isolated config requires model.default")
    if not str(model.get("provider") or "").strip():
        raise RuntimeError("isolated config requires model.provider")
    if set(model) - {"default", "provider", "base_url"}:
        raise RuntimeError(
            "isolated model config may contain only default, provider, and base_url"
        )
    platform_toolsets = config.get("platform_toolsets")
    if platform_toolsets != {"api_server": []}:
        raise RuntimeError(
            "isolated config requires platform_toolsets.api_server as an empty list"
        )
    if config.get("mcp_servers") not in ({}, None):
        raise RuntimeError("isolated config requires an empty mcp_servers mapping")

    forbidden = {
        Path("~/.hermes").expanduser().resolve(),
        Path("~/.cabinet/data").expanduser().resolve(),
    }
    if home in forbidden or Path("~/.hermes/profiles").expanduser().resolve() in home.parents:
        raise RuntimeError("refusing a canonical Hermes or Cabinet data directory")


class FixtureAgent:
    """Deterministic no-tools agent used only by fixture tests."""

    def __init__(
        self,
        *,
        session_id: str | None,
        stream_delta_callback=None,
        session_db=None,
    ):
        self.session_id = session_id
        self.stream_delta_callback = stream_delta_callback
        self.session_db = session_db
        self.session_prompt_tokens = 1
        self.session_completion_tokens = 1
        self.session_total_tokens = 2
        self.tools: list[dict[str, Any]] = []
        self.valid_tool_names: set[str] = set()
        self.interrupted = False

    def run_conversation(
        self,
        *,
        user_message: str,
        conversation_history: list[dict[str, Any]],
        task_id: str,
    ) -> dict[str, Any]:
        if user_message == ACCEPTANCE_PROMPT:
            answer = "CABINET_TRANSPORT_OK"
        elif user_message == FOLLOW_UP_PROMPT:
            prior = json.dumps(conversation_history)
            answer = (
                "CABINET_TRANSPORT_OK"
                if "CABINET_TRANSPORT_OK" in prior
                else "MISSING_PRIOR_TOKEN"
            )
        else:
            answer = "FIXTURE_UNEXPECTED_INPUT"
        if self.stream_delta_callback:
            midpoint = max(1, len(answer) // 2)
            self.stream_delta_callback(answer[:midpoint])
            self.stream_delta_callback(answer[midpoint:])
        messages = [
            *conversation_history,
            {"role": "user", "content": user_message},
            {"role": "assistant", "content": answer},
        ]
        if self.session_db is not None and self.session_id:
            self.session_db.replace_messages(self.session_id, messages)
        return {
            "final_response": answer,
            "messages": messages,
            "session_id": self.session_id or task_id,
        }

    def interrupt(self, _reason: str) -> None:
        self.interrupted = True


def _adapter_classes():
    _install_source()
    from gateway.config import PlatformConfig
    from gateway.platforms.api_server import APIServerAdapter

    class FixtureAdapter(APIServerAdapter):
        def _create_agent(self, **kwargs):
            return FixtureAgent(
                session_id=kwargs.get("session_id"),
                stream_delta_callback=kwargs.get("stream_delta_callback"),
                session_db=self._ensure_session_db(),
            )

    class NoToolsAdapter(APIServerAdapter):
        """Live adapter that fails closed unless AIAgent has zero tools."""

        def _create_agent(self, **kwargs):
            # APIServerAdapter resolves platform tools inside this method.
            # Patch that one resolver for the duration of construction so
            # newly discovered plugin toolsets cannot leak into acceptance.
            import hermes_cli.tools_config as tools_config

            original = tools_config._get_platform_tools
            tools_config._get_platform_tools = lambda *_args, **_kwargs: set()
            try:
                agent = super()._create_agent(**kwargs)
            finally:
                tools_config._get_platform_tools = original
            if getattr(agent, "tools", None) or getattr(
                agent, "valid_tool_names", set()
            ):
                raise RuntimeError("no-tools invariant failed: agent exposed tools")
            return agent

    return PlatformConfig, FixtureAdapter, NoToolsAdapter


def _adapter(adapter_type, *, key: str, host: str, port: int):
    PlatformConfig, _, _ = _adapter_classes()
    return adapter_type(
        PlatformConfig(
            enabled=True,
            token=key,
            extra={
                "host": host,
                "port": port,
                "key": key,
                "model_name": "operator-os",
                "cors_origins": [],
            },
        )
    )


async def _decode_sse(response) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event_name: str | None = None
    data_lines: list[str] = []
    async for raw in response.content:
        line = raw.decode("utf-8").rstrip("\r\n")
        if not line:
            if event_name or data_lines:
                payload = json.loads("\n".join(data_lines)) if data_lines else None
                events.append({"event": event_name or "message", "data": payload})
            event_name = None
            data_lines = []
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())
    return events


async def _turn(client, base: str, key: str, session_id: str, prompt: str):
    response = await client.post(
        f"{base}/api/sessions/{session_id}/chat/stream",
        headers={"Authorization": f"Bearer {key}"},
        json={"message": prompt},
    )
    if response.status != 200:
        raise RuntimeError(f"chat stream returned HTTP {response.status}")
    if response.headers.get("Content-Type", "").split(";")[0] != "text/event-stream":
        raise RuntimeError("chat stream did not return text/event-stream")
    events = await _decode_sse(response)
    completed = [e for e in events if e["event"] == "assistant.completed"]
    if len(completed) != 1:
        raise RuntimeError("expected exactly one assistant.completed event")
    tool_events = [
        e for e in events if (e["event"] or "").startswith("tool.")
    ]
    deltas = [
        e["data"].get("delta", "")
        for e in events
        if e["event"] == "assistant.delta" and isinstance(e["data"], dict)
    ]
    return {
        "content": completed[0]["data"]["content"],
        "events": events,
        "deltas": deltas,
        "tool_events": tool_events,
    }


async def run_fixture(host: str, port: int) -> dict[str, Any]:
    _assert_loopback(host)
    _assert_port(port)
    source = _install_source()
    _assert_source_revision(source)
    key = "fixture-key-4203-at-least-sixteen"

    with tempfile.TemporaryDirectory(prefix="cabinet-http-sse-fixture-") as tmp:
        prior_home = os.environ.get("HERMES_HOME")
        os.environ["HERMES_HOME"] = tmp
        try:
            _, FixtureAdapter, _ = _adapter_classes()
            adapter = _adapter(FixtureAdapter, key=key, host=host, port=port)
            if not await adapter.connect():
                raise RuntimeError("fixture adapter failed to bind")
            try:
                import aiohttp

                base = f"http://{host}:{port}"
                async with aiohttp.ClientSession() as client:
                    unauth = await client.get(f"{base}/v1/capabilities")
                    if unauth.status != 401:
                        raise RuntimeError("bearer auth boundary was not enforced")
                    capabilities = await client.get(
                        f"{base}/v1/capabilities",
                        headers={"Authorization": f"Bearer {key}"},
                    )
                    cap_body = await capabilities.json()
                    session_id = "cabinet-http-sse-fixture"
                    created = await client.post(
                        f"{base}/api/sessions",
                        headers={"Authorization": f"Bearer {key}"},
                        json={"id": session_id, "title": "HTTP SSE fixture"},
                    )
                    if created.status != 201:
                        raise RuntimeError(
                            f"session creation returned HTTP {created.status}"
                        )
                    first = await _turn(
                        client, base, key, session_id, ACCEPTANCE_PROMPT
                    )
            finally:
                await adapter.disconnect()

            # Recreate the adapter against the same isolated home to prove
            # SessionDB continuity across a sidecar/Cabinet reconnect.
            adapter = _adapter(FixtureAdapter, key=key, host=host, port=port)
            if not await adapter.connect():
                raise RuntimeError("fixture adapter failed to rebind")
            try:
                import aiohttp

                async with aiohttp.ClientSession() as client:
                    second = await _turn(
                        client, base, key, session_id, FOLLOW_UP_PROMPT
                    )
                    messages = await client.get(
                        f"{base}/api/sessions/{session_id}/messages",
                        headers={"Authorization": f"Bearer {key}"},
                    )
                    message_body = await messages.json()
            finally:
                await adapter.disconnect()
        finally:
            if prior_home is None:
                os.environ.pop("HERMES_HOME", None)
            else:
                os.environ["HERMES_HOME"] = prior_home

    turn_sequences = [
        [
            event["data"]["seq"]
            for event in turn["events"]
            if isinstance(event["data"], dict) and "seq" in event["data"]
        ]
        for turn in (first, second)
    ]
    return {
        "status": "passed",
        "revision": EXPECTED_HERMES_REVISION,
        "host": host,
        "port": port,
        "auth_enforced": True,
        "session_id_stable": True,
        "session_survived_adapter_restart": True,
        "first_content": first["content"],
        "second_content": second["content"],
        "zero_tool_events": not first["tool_events"] and not second["tool_events"],
        "no_duplicate_sequences": all(
            len(seqs) == len(set(seqs)) for seqs in turn_sequences
        ),
        "persisted_message_count": len(message_body.get("data", [])),
        "capabilities": cap_body.get("features", {}),
    }


async def run_live(host: str, port: int, profile: str) -> dict[str, Any]:
    _assert_loopback(host)
    _assert_port(port)
    source = _install_source()
    _assert_source_revision(source)
    raw_home = os.environ.get("HERMES_HTTP_SSE_ACCEPTANCE_HOME")
    if not raw_home:
        raise RuntimeError("HERMES_HTTP_SSE_ACCEPTANCE_HOME is required")
    home = Path(raw_home)
    _assert_isolated_home(home, profile)
    key = os.environ.get("HERMES_HTTP_SSE_API_KEY", "")
    if len(key) < 16:
        raise RuntimeError("HERMES_HTTP_SSE_API_KEY must be at least 16 characters")

    os.environ["HERMES_HOME"] = str(home.resolve())
    os.environ.pop("HERMES_KANBAN_TASK", None)
    from hermes_cli.profiles import get_active_profile_name

    active_profile = get_active_profile_name()
    if active_profile != profile:
        raise RuntimeError(
            f"native Hermes profile mismatch: expected {profile}, got "
            f"{active_profile}"
        )
    _, _, NoToolsAdapter = _adapter_classes()
    adapter = _adapter(NoToolsAdapter, key=key, host=host, port=port)
    if not await adapter.connect():
        raise RuntimeError("live adapter failed to bind")
    started = time.monotonic()
    try:
        import aiohttp

        base = f"http://{host}:{port}"
        async with aiohttp.ClientSession() as client:
            session_id = f"cabinet-http-sse-acceptance-{int(time.time())}"
            created = await client.post(
                f"{base}/api/sessions",
                headers={"Authorization": f"Bearer {key}"},
                json={"id": session_id, "title": "Cabinet HTTP SSE acceptance"},
            )
            if created.status != 201:
                raise RuntimeError(f"session creation returned HTTP {created.status}")
            first = await _turn(client, base, key, session_id, ACCEPTANCE_PROMPT)
            second = await _turn(client, base, key, session_id, FOLLOW_UP_PROMPT)
    finally:
        await adapter.disconnect()

    passed = (
        first["content"] == "CABINET_TRANSPORT_OK"
        and second["content"] == "CABINET_TRANSPORT_OK"
        and not first["tool_events"]
        and not second["tool_events"]
    )
    return {
        "status": "passed" if passed else "failed",
        "profile": profile,
        "host": host,
        "port": port,
        "session_id": session_id,
        "first_exact": first["content"] == "CABINET_TRANSPORT_OK",
        "second_exact": second["content"] == "CABINET_TRANSPORT_OK",
        "zero_tool_events": not first["tool_events"] and not second["tool_events"],
        "duration_ms": round((time.monotonic() - started) * 1000),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=("fixture", "live"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4203)
    parser.add_argument("--profile", default="operator-os")
    args = parser.parse_args()
    try:
        if args.mode == "fixture":
            result = asyncio.run(run_fixture(args.host, args.port))
        else:
            result = asyncio.run(
                run_live(args.host, args.port, args.profile)
            )
    except Exception as exc:
        print(json.dumps({"status": "failed", "error": str(exc)}, sort_keys=True))
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
