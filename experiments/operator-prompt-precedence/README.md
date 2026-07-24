# Operator prompt precedence experiment

This experiment imports a selected disposable Hermes source checkout, builds
its real system-prompt tiers with bounded operator-profile and Skill fixtures,
and posts OpenAI-shaped requests to a loopback-only fake provider on port 4332.

It records hashes and structural booleans only. It does not read credentials,
contact a model, invoke a tool, or modify a Hermes profile or Skill.

Run it with a Python environment that can import the selected Hermes source:

```text
python capture_precedence.py --companion-source <disposable-source> --port 4332
```
