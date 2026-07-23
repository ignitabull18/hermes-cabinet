#!/usr/bin/env python3
"""Loopback-only wrapper for Hermes' embeddable TUI WebSocket gateway.

The installed Hermes source exposes ``tui_gateway.ws.handle_ws`` as a FastAPI
mount, not as a standalone listener.  This disposable wrapper supplies that
listener and applies an explicit empty-toolset pin that the stock
``HERMES_TUI_TOOLSETS`` parser cannot express.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import sys
from typing import Any

LOOPBACK_HOST = "127.0.0.1"
FIXED_PORT = 4202
REQUIRED_PROFILE = "operator-os"


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hermes-source", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--host", default=LOOPBACK_HOST)
    parser.add_argument("--port", type=int, default=FIXED_PORT)
    parser.add_argument(
        "--fixture-home",
        help="Test-only HERMES_HOME. Mutually exclusive with the live profile.",
    )
    return parser


def _validate_args(args: argparse.Namespace) -> Path:
    source = Path(args.hermes_source).expanduser().resolve()
    if not (source / "tui_gateway" / "ws.py").is_file():
        raise SystemExit("Hermes source does not contain tui_gateway/ws.py")
    if args.host != LOOPBACK_HOST:
        raise SystemExit(f"refusing non-loopback host: {args.host}")
    if args.port != FIXED_PORT:
        raise SystemExit(f"refusing port {args.port}; this probe owns {FIXED_PORT}")
    if args.fixture_home:
        if args.profile != "fixture":
            raise SystemExit("--fixture-home requires --profile fixture")
    elif args.profile != REQUIRED_PROFILE:
        raise SystemExit(f"live mode requires --profile {REQUIRED_PROFILE}")
    return source


def _configure_hermes(source: Path, args: argparse.Namespace) -> Any:
    sys.path.insert(0, str(source))

    if args.fixture_home:
        profile_home = Path(args.fixture_home).expanduser().resolve()
        profile_home.mkdir(parents=True, exist_ok=True)
    else:
        from hermes_cli.profiles import resolve_profile_env

        profile_home = Path(resolve_profile_env(args.profile)).resolve()

    os.environ["HERMES_HOME"] = str(profile_home)
    os.environ["HERMES_PROFILE"] = args.profile
    os.environ["HERMES_TUI_CHECKPOINTS"] = "0"
    os.environ["HERMES_IGNORE_RULES"] = "1"

    # Import only after HERMES_HOME is exact; Hermes has module-level path
    # caches.  The explicit empty list is intentional. The stock environment
    # parser treats an empty or unknown HERMES_TUI_TOOLSETS value as fallback.
    from tui_gateway import server
    from hermes_cli import mcp_startup
    import run_agent

    # Two independent pins make the acceptance invariant insensitive to the
    # installed TUI resolver and to later agent initialization. They are armed
    # before any WebSocket can create a session or resolve a provider.
    server._load_enabled_toolsets = lambda: []
    run_agent.get_tool_definitions = lambda **_kwargs: []
    mcp_startup.start_background_mcp_discovery = lambda **_kwargs: None

    if args.fixture_home:
        # Hermes' installed synthetic agent seam exercises the full dispatcher,
        # persistence and cancellation path without a model call or credential.
        os.environ["HERMES_ISO_CERTIFY_SYNTH_TURN"] = "1"

    return profile_home


def create_app(source: Path, args: argparse.Namespace):
    _configure_hermes(source, args)
    from fastapi import FastAPI, WebSocket
    from tui_gateway.ws import handle_ws

    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    async def rpc(websocket: WebSocket) -> None:
        await handle_ws(websocket)

    # Register explicitly because this function-local endpoint annotation is
    # postponed by ``from __future__ import annotations``.
    rpc.__annotations__["websocket"] = WebSocket
    app.add_api_websocket_route("/rpc", rpc)
    return app


def main() -> None:
    args = _parser().parse_args()
    source = _validate_args(args)
    app = create_app(source, args)
    import uvicorn

    uvicorn.run(
        app,
        host=LOOPBACK_HOST,
        port=FIXED_PORT,
        access_log=False,
        log_level="warning",
    )


if __name__ == "__main__":
    main()
