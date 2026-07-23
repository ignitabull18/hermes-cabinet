from __future__ import annotations

import asyncio
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest

EXPERIMENT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(EXPERIMENT))

from probe import RpcClient  # noqa: E402


class FixtureTransportTest(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if os.environ.get("TUI_GATEWAY_FIXTURE_E2E") != "1":
            self.skipTest("set TUI_GATEWAY_FIXTURE_E2E=1 for socket fixture")
        hermes = Path("<user-home>/.hermes/hermes-agent")
        python = hermes / "venv/bin/python"
        self.proc = subprocess.Popen(
            [
                str(python),
                str(EXPERIMENT / "sidecar.py"),
                "--hermes-source",
                str(hermes),
                "--profile",
                "fixture",
                "--fixture-home",
                tempfile.mkdtemp(prefix="tui-gateway-fixture-"),
            ],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            with socket.socket() as sock:
                if sock.connect_ex(("127.0.0.1", 4202)) == 0:
                    break
            await asyncio.sleep(0.05)
        else:
            self.fail("fixture sidecar did not bind")

    async def asyncTearDown(self):
        if hasattr(self, "proc"):
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
            if self.proc.stderr is not None:
                self.proc.stderr.close()

    async def test_real_dispatcher_create_status_and_errors(self):
        client = await RpcClient.connect()
        created = await client.request(
            "session.create",
            {
                "title": "fixture",
                "source": "cabinet-transport-fixture",
                "close_on_disconnect": True,
            },
        )
        self.assertEqual(created["info"]["tools"], {})
        status = await client.request(
            "session.status", {"session_id": created["session_id"]}
        )
        self.assertIn("Agent Running: No", status["output"])
        turn = await client.run_turn(
            created["session_id"],
            '{"duration_s":0.05,"delta_interval_s":0.01,"chunk":1000}',
        )
        self.assertIn("[synthetic heavy turn]", turn.response)
        self.assertGreaterEqual(turn.event_count, 2)
        client.assert_no_tools()
        for _ in range(20):
            status = await client.request(
                "session.status", {"session_id": created["session_id"]}
            )
            if "Agent Running: No" in status["output"]:
                break
            await asyncio.sleep(0.01)
        else:
            self.fail("fixture turn did not settle")

        cancellation_start = len(client.events)
        started = await client.request(
            "prompt.submit",
            {
                "session_id": created["session_id"],
                "text": '{"duration_s":2,"delta_interval_s":0.01,"chunk":1000}',
            },
        )
        self.assertEqual(started["status"], "streaming")
        await client.wait_for_event(
            "message.delta",
            session_id=created["session_id"],
            timeout=2,
            after_index=cancellation_start,
        )
        interrupted = await client.request(
            "session.interrupt", {"session_id": created["session_id"]}
        )
        self.assertEqual(interrupted["status"], "interrupted")
        completed = await client.wait_for_event(
            "message.complete",
            session_id=created["session_id"],
            timeout=2,
            after_index=cancellation_start,
        )
        self.assertEqual((completed.get("payload") or {}).get("status"), "interrupted")
        with self.assertRaisesRegex(Exception, "unknown method"):
            await client.request("fixture.unknown", {})
        await client.close()


if __name__ == "__main__":
    unittest.main()
