# Profile-safe gateway lifecycle experiment

This is a non-dispatching behavior model for the minimum lifecycle invariants
Cabinet should require from Hermes:

- every managed service is launched with an explicit profile, including
  `--profile default`;
- routine replacement authority is restricted to the exact profile, canonical
  Hermes home, and service identity prepared by the operator;
- named independent gateways must configure listener ports explicitly;
- listener collisions are rejected before bind and represented by host-level
  lease keys;
- multiplexed secondary profiles cannot own listeners;
- shared Kanban dispatch is assigned to an explicit owner per board instead of
  whichever gateway wins a startup race; and
- restart acceptance requires a new process identity, the prepared generation,
  readiness, and the expected bound ports.

The model intentionally does not import Hermes, call a supervisor, mutate a
profile, terminate a process, or bind a port.

Run:

```sh
python3 -m unittest -v test_gateway_lifecycle.py
```
