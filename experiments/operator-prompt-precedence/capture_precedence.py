#!/usr/bin/env python3
"""Offline operator prompt-precedence differential.

Builds the real Hermes system-prompt tiers from a selected source checkout,
posts OpenAI-shaped requests only to a loopback fake provider, and records
bounded structural facts. It never reads credentials or contacts a model.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
import threading
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from types import SimpleNamespace
from unittest.mock import patch


PROFILE_DEFAULT = (
    "You are the primary operator.\n"
    "Every run reports what it did, what changed, evidence, success or failure, "
    "what requires the operator, and the next action."
)
SKILL_INDEX = (
    "## Skills (mandatory)\n"
    "<available_skills>\n"
    "communication:\n"
    "  - one-three-one-rule: Structured decision-making framework for technical "
    "proposals and trade-off analysis.\n"
    "</available_skills>"
)
SKILL_BODY_MARKER = "# 1-3-1 Communication Rule"

EXPECTED = {
    "operator_no_skills": "Run complete. Evidence captured. Next action: review.",
    "operator_skill_available": (
        "Problem: choose a cache.\nOptions: A, B, C.\nRecommendation: A."
    ),
    "exact_output": "CABINET_ACCEPTANCE_OK",
    "ordinary_decision": (
        "Problem: choose a cache.\nOptions: A, B, C.\nRecommendation: A."
    ),
    "same_session_followup": "CABINET_ACCEPTANCE_OK",
    "no_tools": "CABINET_ACCEPTANCE_OK",
    "tools_no_invocation": "CABINET_ACCEPTANCE_OK",
    "alpha": "ALPHA",
    "json_only": '{"ok":true}',
    "one_word": "Ready",
}


class CaptureHandler(BaseHTTPRequestHandler):
    requests: list[dict] = []

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        length = int(self.headers.get("content-length", "0"))
        payload = json.loads(self.rfile.read(length))
        case = self.headers["x-case"]
        self.__class__.requests.append({"case": case, "payload": payload})
        body = {
            "id": f"fake-{case}",
            "object": "chat.completion",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": EXPECTED[case]},
                    "finish_reason": "stop",
                }
            ],
        }
        encoded = json.dumps(body, separators=(",", ":")).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, _format: str, *_args: object) -> None:
        return


def make_agent(*, with_tools: bool) -> SimpleNamespace:
    names = ["skill_view"] if with_tools else []
    return SimpleNamespace(
        load_soul_identity=True,
        skip_context_files=True,
        valid_tool_names=names,
        _task_completion_guidance=False,
        _parallel_tool_call_guidance=False,
        _tool_use_enforcement=False,
        _environment_probe=False,
        _kanban_worker_guidance="",
        _memory_store=None,
        _memory_manager=None,
        model="fixture-model",
        provider="fixture-provider",
        platform="acp",
        pass_session_id=False,
        session_id="fixture-session",
    )


def build_prompt(with_tools: bool) -> str:
    from agent.system_prompt import build_system_prompt_parts

    skills = SKILL_INDEX if with_tools else ""
    with (
        patch("run_agent.load_soul_md", return_value=PROFILE_DEFAULT),
        patch("run_agent.build_nous_subscription_prompt", return_value=""),
        patch("run_agent.build_environment_hints", return_value=""),
        patch("run_agent.build_context_files_prompt", return_value=""),
        patch("run_agent.build_skills_system_prompt", return_value=skills),
        patch("run_agent.get_toolset_for_tool", return_value="skills"),
    ):
        parts = build_system_prompt_parts(make_agent(with_tools=with_tools))
    return "\n\n".join(
        part for part in (parts["stable"], parts["context"], parts["volatile"]) if part
    )


def request_case(
    port: int,
    *,
    name: str,
    user: str,
    with_tools: bool,
    history: list[dict] | None = None,
) -> dict:
    system = build_prompt(with_tools)
    messages = [{"role": "system", "content": system}]
    messages.extend(history or [])
    messages.append({"role": "user", "content": user})
    payload = {"model": "fixture-model", "messages": messages}
    if with_tools:
        payload["tools"] = [
            {
                "type": "function",
                "function": {
                    "name": "skill_view",
                    "description": "Load one deliberately selected Skill.",
                    "parameters": {"type": "object"},
                },
            }
        ]
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/v1/chat/completions",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"content-type": "application/json", "x-case": name},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        completion = json.loads(response.read())
    output = completion["choices"][0]["message"]["content"]
    precedence = "# Explicit output constraints"
    return {
        "case": name,
        "system_sha256": hashlib.sha256(system.encode()).hexdigest(),
        "profile_default_present": "Every run reports" in system,
        "skills_index_present": SKILL_INDEX in system,
        "skill_body_injected": SKILL_BODY_MARKER in system,
        "precedence_present": precedence in system,
        "precedence_after_profile": system.index(precedence)
        > system.index("Every run reports"),
        "precedence_after_skill_index": (
            not with_tools or system.index(precedence) > system.index("one-three-one-rule")
        ),
        "tools_present": bool(payload.get("tools")),
        "tool_calls_returned": bool(
            completion["choices"][0]["message"].get("tool_calls")
        ),
        "user_is_last_message": messages[-1]["role"] == "user"
        and messages[-1]["content"] == user,
        "response_exact": output == EXPECTED[name],
        "response_sha256": hashlib.sha256(output.encode()).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--companion-source", required=True)
    parser.add_argument("--port", type=int, default=4332)
    args = parser.parse_args()
    cases = [
        dict(name="operator_no_skills", user="Report current status.", with_tools=False),
        dict(
            name="operator_skill_available",
            user="Compare three technical cache approaches.",
            with_tools=True,
        ),
        dict(
            name="exact_output",
            user="Reply with exactly CABINET_ACCEPTANCE_OK.",
            with_tools=True,
        ),
        dict(
            name="ordinary_decision",
            user="Give me options for a technical cache decision.",
            with_tools=True,
        ),
        dict(
            name="same_session_followup",
            user="Reply with the exact acceptance token from your previous response.",
            with_tools=False,
            history=[
                {"role": "user", "content": "Reply with exactly CABINET_ACCEPTANCE_OK."},
                {"role": "assistant", "content": "CABINET_ACCEPTANCE_OK"},
            ],
        ),
        dict(
            name="no_tools",
            user="Reply with exactly CABINET_ACCEPTANCE_OK.",
            with_tools=False,
        ),
        dict(
            name="tools_no_invocation",
            user="Reply with exactly CABINET_ACCEPTANCE_OK.",
            with_tools=True,
        ),
        dict(name="alpha", user="Reply with exactly ALPHA.", with_tools=True),
        dict(
            name="json_only",
            user='Return only valid JSON: {"ok":true}',
            with_tools=True,
        ),
        dict(name="one_word", user="Answer with one word: Ready", with_tools=True),
    ]

    with tempfile.TemporaryDirectory(prefix="hermes-precedence-") as hermes_home:
        # Resolve all profile/config/cache reads against a disposable empty
        # root before importing Hermes. This prevents live profile writes and
        # external secret-source discovery.
        os.environ["HERMES_HOME"] = hermes_home
        os.environ["HERMES_PROFILE"] = "operator-os"
        sys.path.insert(0, args.companion_source)

        server = ThreadingHTTPServer(("127.0.0.1", args.port), CaptureHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            results = [request_case(args.port, **case) for case in cases]
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

    output = {
        "schema": "operator-prompt-precedence/v1",
        "provider": "loopback-fixture",
        "external_model_requests": 0,
        "loopback_requests": len(CaptureHandler.requests),
        "cases": results,
        "all_passed": all(
            row["precedence_present"]
            and row["precedence_after_profile"]
            and row["precedence_after_skill_index"]
            and row["user_is_last_message"]
            and row["response_exact"]
            and not row["skill_body_injected"]
            and not row["tool_calls_returned"]
            for row in results
        ),
    }
    print(json.dumps(output, indent=2, sort_keys=True))
    return 0 if output["all_passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
