from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

EXPERIMENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPERIMENT))

from probe import MAX_FRAME_BYTES, ProtocolError, RpcClient  # noqa: E402


class _FakeWebSocket:
    def __init__(self, frames):
        self.frames = list(frames)
        self.sent = []

    async def recv(self):
        return self.frames.pop(0)

    async def send(self, value):
        self.sent.append(value)

    async def close(self):
        return None


class ProbeUnitTests(unittest.IsolatedAsyncioTestCase):
    def test_rejects_non_jsonrpc_frame(self):
        with self.assertRaisesRegex(ProtocolError, "malformed JSON-RPC"):
            RpcClient._parse('{"hello":"world"}')

    def test_rejects_oversized_frame(self):
        with self.assertRaisesRegex(ProtocolError, "exceeds"):
            RpcClient._parse(" " * (MAX_FRAME_BYTES + 1))

    async def test_deduplicates_identical_events(self):
        frame = {
            "jsonrpc": "2.0",
            "method": "event",
            "params": {"type": "message.delta", "session_id": "s", "payload": {"text": "x"}},
        }
        ws = _FakeWebSocket([json.dumps(frame), json.dumps(frame)])
        client = RpcClient(ws)
        await client._next(timeout=1)
        await client._next(timeout=1)
        self.assertEqual(len(client.events), 1)
        self.assertEqual(client.duplicate_count, 1)

    async def test_rejects_malformed_event(self):
        frame = {
            "jsonrpc": "2.0",
            "method": "event",
            "params": {"session_id": "s"},
        }
        client = RpcClient(_FakeWebSocket([json.dumps(frame)]))
        with self.assertRaisesRegex(ProtocolError, "malformed event"):
            await client._next(timeout=1)

    async def test_request_is_bounded(self):
        client = RpcClient(_FakeWebSocket([]))
        with self.assertRaises((TimeoutError, IndexError)):
            await client.request("never", {}, timeout=0.001)

    async def test_turn_drains_stream_buffered_before_rpc_response(self):
        def event(event_type, payload=None):
            params = {"type": event_type, "session_id": "session-1"}
            if payload is not None:
                params["payload"] = payload
            return {"jsonrpc": "2.0", "method": "event", "params": params}

        frames = [
            event("message.start"),
            event("message.delta", {"text": "CABINET_"}),
            event(
                "message.complete",
                {"text": "CABINET_TRANSPORT_OK", "status": "complete"},
            ),
            {
                "jsonrpc": "2.0",
                "id": "1",
                "result": {"status": "streaming"},
            },
        ]
        client = RpcClient(_FakeWebSocket([json.dumps(frame) for frame in frames]))

        turn = await client.run_turn("session-1", "fixture")

        self.assertEqual(turn.response, "CABINET_TRANSPORT_OK")
        self.assertEqual(turn.event_count, 3)


class SidecarGuards(unittest.TestCase):
    def setUp(self):
        self.sidecar = EXPERIMENT / "sidecar.py"
        self.hermes = Path("<user-home>/.hermes/hermes-agent")

    def _run(self, *extra):
        return subprocess.run(
            [
                sys.executable,
                str(self.sidecar),
                "--hermes-source",
                str(self.hermes),
                "--profile",
                "fixture",
                "--fixture-home",
                tempfile.mkdtemp(prefix="tui-gateway-fixture-"),
                *extra,
            ],
            text=True,
            capture_output=True,
            timeout=10,
        )

    def test_rejects_non_loopback_host(self):
        result = self._run("--host", "0.0.0.0")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing non-loopback", result.stderr)

    def test_rejects_wrong_port(self):
        result = self._run("--port", "4000")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("refusing port", result.stderr)


if __name__ == "__main__":
    unittest.main()
