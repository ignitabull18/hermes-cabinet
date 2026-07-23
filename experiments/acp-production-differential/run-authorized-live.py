#!/usr/bin/env python3

import os
import shutil
import subprocess
import sys
from pathlib import Path
import yaml

COMPANION_ROOT = Path(
    Path.home(), "projects/worktrees/hermes-agent-parallel-v2/acp"
)
EXPERIMENT = Path(__file__).with_name("live-route-diagnostic.mjs")

sys.path.insert(0, str(COMPANION_ROOT))
from agent.secret_sources.onepassword import fetch_onepassword_secrets  # noqa: E402


def main() -> int:
    config = yaml.safe_load(Path(Path.home(), ".hermes/config.yaml").read_text())
    reference = config["secrets"]["onepassword"]["env"]["OLLAMA_API_KEY"]
    secrets, _warnings = fetch_onepassword_secrets(
        references={"OLLAMA_API_KEY": reference},
        use_cache=False,
    )
    credential = secrets.get("OLLAMA_API_KEY")
    if not credential:
        raise RuntimeError("approved provider credential was unavailable")
    env = {
        "PATH": os.environ.get("PATH", ""),
        "LANG": os.environ.get("LANG", "en_US.UTF-8"),
        "OLLAMA_API_KEY": credential,
    }
    node = shutil.which("node")
    if not node:
        raise RuntimeError("node runtime was unavailable")
    completed = subprocess.run(
        [node, str(EXPERIMENT), "--authorized-live"],
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        check=False,
    )
    if completed.returncode != 0:
        print("authorized diagnostic failed before producing a bounded result")
        return completed.returncode
    print(completed.stdout.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
