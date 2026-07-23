#!/usr/bin/env python3
"""Bounded JSON-RPC client and two-turn TUI-gateway acceptance harness."""

from __future__ import annotations

import argparse
import asyncio
from dataclasses import dataclass, field
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import time
from typing import Any
import uuid

HOST = "127.0.0.1"
PORT = 4202
URL = f"ws://{HOST}:{PORT}/rpc"
PROMPT = (
    "This is a local Cabinet transport acceptance test. Do not use tools or "
    "contact external systems. Reply with exactly CABINET_TRANSPORT_OK."
)
FOLLOW_UP = "Reply with the exact transport token from your previous response."
EXPECTED = "CABINET_TRANSPORT_OK"
MAX_FRAME_BYTES = 1_000_000
RPC_TIMEOUT_S = 20.0
TURN_TIMEOUT_S = 180.0
READY_TIMEOUT_S = 30.0
MAX_EVENTS = 20_000


class ProtocolError(RuntimeError):
    pass


@dataclass
class TurnMetrics:
    response: str
    first_event_ms: float
    completed_ms: float
    event_count: int
    duplicate_count: int


@dataclass
class SidecarProcess:
    process: subprocess.Popen
    startup_ms: float


@dataclass
class RpcClient:
    websocket: Any
    next_id: int = 1
    responses: dict[str, dict] = field(default_factory=dict)
    events: list[dict] = field(default_factory=list)
    event_received_at: list[float] = field(default_factory=list)
    seen_events: set[str] = field(default_factory=set)
    duplicate_count: int = 0

    @classmethod
    async def connect(cls) -> "RpcClient":
        import websockets

        ws = await asyncio.wait_for(
            websockets.connect(
                URL,
                max_size=MAX_FRAME_BYTES,
                open_timeout=READY_TIMEOUT_S,
                close_timeout=5,
            ),
            timeout=READY_TIMEOUT_S,
        )
        client = cls(ws)
        ready = await client._receive(timeout=READY_TIMEOUT_S)
        if (
            ready.get("method") != "event"
            or (ready.get("params") or {}).get("type") != "gateway.ready"
        ):
            raise ProtocolError("first frame was not gateway.ready")
        return client

    async def close(self) -> None:
        await self.websocket.close()

    @staticmethod
    def _parse(raw: str | bytes) -> dict:
        size = len(raw)
        if size > MAX_FRAME_BYTES:
            raise ProtocolError(f"frame exceeds {MAX_FRAME_BYTES} bytes")
        try:
            value = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            raise ProtocolError("malformed JSON frame") from exc
        if not isinstance(value, dict) or value.get("jsonrpc") != "2.0":
            raise ProtocolError("malformed JSON-RPC frame")
        if "method" not in value and "id" not in value:
            raise ProtocolError("frame has neither method nor id")
        return value

    async def _receive(self, *, timeout: float) -> dict:
        raw = await asyncio.wait_for(self.websocket.recv(), timeout=timeout)
        return self._parse(raw)

    def _record_event(self, frame: dict) -> None:
        params = frame.get("params")
        if not isinstance(params, dict) or not isinstance(params.get("type"), str):
            raise ProtocolError("malformed event envelope")
        canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
        digest = hashlib.sha256(canonical.encode()).hexdigest()
        if digest in self.seen_events:
            self.duplicate_count += 1
            return
        self.seen_events.add(digest)
        self.events.append(frame)
        self.event_received_at.append(time.monotonic())
        if len(self.events) > MAX_EVENTS:
            raise ProtocolError("event limit exceeded")

    async def _next(self, *, timeout: float) -> dict:
        frame = await self._receive(timeout=timeout)
        if frame.get("method") == "event":
            self._record_event(frame)
        elif "id" in frame:
            self.responses[str(frame["id"])] = frame
        return frame

    async def request(
        self, method: str, params: dict, *, timeout: float = RPC_TIMEOUT_S
    ) -> dict:
        request_id = str(self.next_id)
        self.next_id += 1
        await self.websocket.send(
            json.dumps(
                {
                    "jsonrpc": "2.0",
                    "id": request_id,
                    "method": method,
                    "params": params,
                },
                separators=(",", ":"),
            )
        )
        deadline = time.monotonic() + timeout
        while request_id not in self.responses:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"{method} timed out")
            await self._next(timeout=remaining)
        response = self.responses.pop(request_id)
        if error := response.get("error"):
            raise ProtocolError(
                f"{method} failed: {error.get('code')} {error.get('message')}"
            )
        result = response.get("result")
        if not isinstance(result, dict):
            raise ProtocolError(f"{method} returned a non-object result")
        return result

    async def wait_for_event(
        self,
        event_type: str,
        *,
        session_id: str | None = None,
        timeout: float,
        after_index: int = 0,
    ) -> dict:
        deadline = time.monotonic() + timeout
        cursor = max(0, after_index)
        while True:
            while cursor < len(self.events):
                frame = self.events[cursor]
                cursor += 1
                params = frame["params"]
                if params["type"] == event_type and (
                    session_id is None or params.get("session_id") == session_id
                ):
                    return params
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"event {event_type} timed out")
            await self._next(timeout=remaining)

    def assert_no_tools(self) -> None:
        forbidden = [
            e
            for e in self.events
            if str(e["params"]["type"]).startswith("tool.")
            or str(e["params"]["type"]).startswith("subagent.")
        ]
        if forbidden:
            raise ProtocolError("tool or subagent event observed in no-tools run")

    async def run_turn(self, session_id: str, text: str) -> TurnMetrics:
        start = time.monotonic()
        before = len(self.events)
        duplicates_before = self.duplicate_count
        result = await self.request(
            "prompt.submit",
            {"session_id": session_id, "text": text},
            timeout=RPC_TIMEOUT_S,
        )
        if result.get("status") != "streaming":
            raise ProtocolError("prompt.submit did not enter streaming state")

        first_event_at: float | None = None
        response_text = ""
        saw_message_start = False
        deadline = start + TURN_TIMEOUT_S
        cursor = before

        def consume(frame: dict, received_at: float) -> TurnMetrics | None:
            nonlocal first_event_at, response_text, saw_message_start
            params = frame["params"]
            if params.get("session_id") != session_id:
                return None
            event_type = params["type"]
            if event_type == "message.start":
                saw_message_start = True
            if event_type in {"message.delta", "message.complete", "error"}:
                if event_type != "error" and not saw_message_start:
                    raise ProtocolError("message stream arrived before message.start")
                first_event_at = first_event_at or received_at
            payload = params.get("payload") or {}
            if event_type == "message.delta":
                response_text += str(payload.get("text") or "")
            elif event_type == "message.complete":
                final = str(payload.get("text") or response_text).strip()
                self.assert_no_tools()
                return TurnMetrics(
                    response=final,
                    first_event_ms=round(
                        ((first_event_at or received_at) - start) * 1000, 2
                    ),
                    completed_ms=round((received_at - start) * 1000, 2),
                    event_count=len(self.events) - before,
                    duplicate_count=self.duplicate_count - duplicates_before,
                )
            elif event_type == "error":
                raise ProtocolError(str(payload.get("message") or "turn error"))
            return None

        while True:
            # prompt.submit is dispatched on Hermes' worker pool. Its synchronous
            # message.start (and, for a fast response, later stream frames) may
            # reach request() before the RPC response. Drain those buffered
            # events before awaiting another frame.
            while cursor < len(self.events):
                frame = self.events[cursor]
                received_at = self.event_received_at[cursor]
                cursor += 1
                if outcome := consume(frame, received_at):
                    return outcome

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("turn timed out")
            await self._next(timeout=remaining)


def _wait_for_port(proc: subprocess.Popen, timeout: float = READY_TIMEOUT_S) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            raise RuntimeError(f"sidecar exited before bind (code {proc.returncode})")
        with socket.socket() as sock:
            sock.settimeout(0.2)
            if sock.connect_ex((HOST, PORT)) == 0:
                return
        time.sleep(0.05)
    raise TimeoutError("sidecar did not bind port 4202")


def _assert_port_free() -> None:
    with socket.socket() as sock:
        sock.settimeout(0.2)
        if sock.connect_ex((HOST, PORT)) == 0:
            raise RuntimeError("refusing to interact with an existing listener on port 4202")


def _start_sidecar(python: str, sidecar: str, hermes_source: str) -> SidecarProcess:
    _assert_port_free()
    started = time.monotonic()
    proc = subprocess.Popen(
        [
            python,
            sidecar,
            "--hermes-source",
            hermes_source,
            "--profile",
            "operator-os",
            "--host",
            HOST,
            "--port",
            str(PORT),
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _wait_for_port(proc)
    return SidecarProcess(
        process=proc,
        startup_ms=round((time.monotonic() - started) * 1000, 2),
    )


def _rss_kib(proc: subprocess.Popen) -> int | None:
    if proc.poll() is not None:
        return None
    result = subprocess.run(
        ["ps", "-o", "rss=", "-p", str(proc.pid)],
        text=True,
        capture_output=True,
        timeout=2,
    )
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def _stop_sidecar(proc: subprocess.Popen) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait(timeout=5)


async def _acceptance(args: argparse.Namespace) -> dict:
    label = f"cabinet-tui-gateway-{uuid.uuid4().hex[:12]}"
    first_sidecar = _start_sidecar(args.python, args.sidecar, args.hermes_source)
    first_proc = first_sidecar.process
    try:
        client = await RpcClient.connect()
        created = await client.request(
            "session.create",
            {
                "title": label,
                "profile": "operator-os",
                "source": "cabinet-transport-acceptance",
                "close_on_disconnect": False,
            },
        )
        session_id = str(created["session_id"])
        stored_session_id = str(created["stored_session_id"])
        info_event = await client.wait_for_event(
            "session.info", session_id=session_id, timeout=READY_TIMEOUT_S
        )
        info = info_event.get("payload") or {}
        if info.get("profile_name") != "operator-os":
            raise ProtocolError("session did not bind operator-os")
        if info.get("tools") not in ({}, None):
            raise ProtocolError("session.info advertised tools")
        first = await client.run_turn(session_id, PROMPT)
        if first.response != EXPECTED:
            raise ProtocolError("initial response did not match acceptance token")
        first_rss_kib = _rss_kib(first_proc)
        await client.close()
    finally:
        _stop_sidecar(first_proc)

    # A new process proves server restart durability, not merely WS reconnect.
    second_sidecar = _start_sidecar(args.python, args.sidecar, args.hermes_source)
    second_proc = second_sidecar.process
    try:
        client = await RpcClient.connect()
        resumed = await client.request(
            "session.resume",
            {
                "session_id": stored_session_id,
                "profile": "operator-os",
                "source": "cabinet-transport-acceptance",
                "close_on_disconnect": False,
            },
        )
        session_id = str(resumed["session_id"])
        history = resumed.get("messages") or []
        if not any(EXPECTED in str(item.get("content") or "") for item in history):
            raise ProtocolError("resumed transcript did not contain first token")
        second = await client.run_turn(session_id, FOLLOW_UP)
        if second.response != EXPECTED:
            raise ProtocolError("follow-up did not preserve acceptance token")
        status = await client.request("session.status", {"session_id": session_id})
        client.assert_no_tools()
        second_rss_kib = _rss_kib(second_proc)
        await client.close()
    finally:
        _stop_sidecar(second_proc)

    return {
        "status": "passed",
        "transport": "websocket-jsonrpc-2.0",
        "profile": "operator-os",
        "port": PORT,
        "acceptance_label": label,
        "session_persisted_across_sidecar_restart": True,
        "no_tools": True,
        "protocol_parse_errors": 0,
        "stream_ordering": "message.start before deltas and completion",
        "sidecar_startup_ms": [
            first_sidecar.startup_ms,
            second_sidecar.startup_ms,
        ],
        "sidecar_rss_kib": [first_rss_kib, second_rss_kib],
        "first_turn": first.__dict__,
        "second_turn": second.__dict__,
        "final_session_running": "Agent Running: Yes" in str(status.get("output") or ""),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", required=True)
    parser.add_argument("--sidecar", required=True)
    parser.add_argument("--hermes-source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Required guard: this performs the authorized two-turn model test.",
    )
    args = parser.parse_args()
    if not args.confirm_live:
        raise SystemExit("refusing live model use without --confirm-live")
    if Path(args.sidecar).resolve() != Path(__file__).with_name("sidecar.py").resolve():
        raise SystemExit("--sidecar must name this experiment's sidecar.py")
    result = asyncio.run(_acceptance(args))
    Path(args.output).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
