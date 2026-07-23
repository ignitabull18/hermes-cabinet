from __future__ import annotations

import asyncio
import importlib.util
import os
import socket
import sys
from pathlib import Path

import pytest


PROBE_PATH = Path(__file__).with_name("probe.py")
SPEC = importlib.util.spec_from_file_location("cabinet_http_sse_probe", PROBE_PATH)
assert SPEC and SPEC.loader
probe = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = probe
SPEC.loader.exec_module(probe)


def test_safety_guards_reject_wrong_bindings():
    with pytest.raises(RuntimeError, match="127.0.0.1"):
        probe._assert_loopback("0.0.0.0")
    with pytest.raises(RuntimeError, match="4203"):
        probe._assert_port(4000)


def test_acceptance_prompts_are_exact():
    assert probe.ACCEPTANCE_PROMPT == (
        "This is a local Cabinet transport acceptance test. Do not use tools "
        "or contact external systems. Reply with exactly CABINET_TRANSPORT_OK."
    )
    assert probe.FOLLOW_UP_PROMPT == (
        "Reply with the exact transport token from your previous response."
    )


def test_canonical_homes_are_rejected(tmp_path):
    profile_home = tmp_path / "profiles" / "operator-os"
    profile_home.mkdir(parents=True)
    marker = profile_home / probe.PROFILE_MARKER
    marker.write_text("operator-os", encoding="utf-8")
    (profile_home / "config.yaml").write_text(
        "model:\n"
        "  default: fixture\n"
        "  provider: fixture\n"
        "platform_toolsets:\n"
        "  api_server: []\n"
        "mcp_servers: {}\n",
        encoding="utf-8",
    )
    old_home = os.environ.get("HOME")
    try:
        os.environ["HOME"] = str(tmp_path.parent)
        with pytest.raises(RuntimeError):
            probe._assert_isolated_home(tmp_path.parent / ".hermes", "operator-os")
    finally:
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home


def test_isolated_profile_layout_and_minimal_config_are_accepted(tmp_path):
    profile_home = tmp_path / "profiles" / "operator-os"
    profile_home.mkdir(parents=True)
    (profile_home / probe.PROFILE_MARKER).write_text(
        "operator-os\n", encoding="utf-8"
    )
    (profile_home / "config.yaml").write_text(
        "model:\n"
        "  default: fixture-model\n"
        "  provider: fixture-provider\n"
        "platform_toolsets:\n"
        "  api_server: []\n"
        "mcp_servers: {}\n",
        encoding="utf-8",
    )
    probe._assert_isolated_home(profile_home, "operator-os")


def test_fixture_runs_real_http_sse_adapter_on_4203():
    # Fail clearly if another stream ignored the port allocation.
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 4203))
    result = asyncio.run(probe.run_fixture("127.0.0.1", 4203))
    assert result["status"] == "passed"
    assert result["first_content"] == "CABINET_TRANSPORT_OK"
    assert result["second_content"] == "CABINET_TRANSPORT_OK"
    assert result["auth_enforced"] is True
    assert result["zero_tool_events"] is True
    assert result["session_id_stable"] is True
    assert result["session_survived_adapter_restart"] is True
    assert result["persisted_message_count"] >= 4
    assert result["capabilities"]["session_chat_streaming"] is True
    assert result["capabilities"]["run_events_sse"] is True


def test_live_adapter_forces_zero_tools_and_restores_resolver(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    PlatformConfig, _, NoToolsAdapter = probe._adapter_classes()
    parent = NoToolsAdapter.__mro__[1]
    import hermes_cli.tools_config as tools_config

    original_resolver = tools_config._get_platform_tools
    seen = {}

    class EmptyAgent:
        tools = []
        valid_tool_names = set()

    def fake_parent_create(_self, **_kwargs):
        seen["resolved"] = tools_config._get_platform_tools({}, "api_server")
        return EmptyAgent()

    monkeypatch.setattr(parent, "_create_agent", fake_parent_create)
    adapter = NoToolsAdapter(
        PlatformConfig(
            enabled=True,
            extra={
                "host": "127.0.0.1",
                "port": 4203,
                "key": "fixture-key-4203-at-least-sixteen",
            },
        )
    )
    agent = adapter._create_agent(session_id="fixture")
    assert agent.tools == []
    assert seen["resolved"] == set()
    assert tools_config._get_platform_tools is original_resolver


def test_live_adapter_fails_closed_if_a_tool_survives(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))
    PlatformConfig, _, NoToolsAdapter = probe._adapter_classes()
    parent = NoToolsAdapter.__mro__[1]

    class UnsafeAgent:
        tools = [{"type": "function"}]
        valid_tool_names = {"terminal"}

    monkeypatch.setattr(
        parent, "_create_agent", lambda _self, **_kwargs: UnsafeAgent()
    )
    adapter = NoToolsAdapter(
        PlatformConfig(
            enabled=True,
            extra={
                "host": "127.0.0.1",
                "port": 4203,
                "key": "fixture-key-4203-at-least-sixteen",
            },
        )
    )
    with pytest.raises(RuntimeError, match="no-tools invariant failed"):
        adapter._create_agent(session_id="fixture")
