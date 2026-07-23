"""Disposable model for profile-safe Hermes gateway lifecycle management.

This module does not call Hermes, launchctl, or bind ports.  It models the
invariants Cabinet should require before a lifecycle action is dispatchable.
"""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
from typing import Iterable


class LifecycleError(ValueError):
    """A lifecycle request is not safe to dispatch."""


def _canonical(path: str) -> str:
    return str(Path(path).expanduser().resolve())


@dataclass(frozen=True)
class ProfileIdentity:
    profile_id: str
    hermes_home: str
    service_id: str

    @classmethod
    def resolve(
        cls, profile_id: str, hermes_home: str, default_home: str
    ) -> "ProfileIdentity":
        profile_id = profile_id.strip()
        home = _canonical(hermes_home)
        root = _canonical(default_home)
        expected = root if profile_id == "default" else _canonical(
            str(Path(root) / "profiles" / profile_id)
        )
        if home != expected:
            raise LifecycleError(
                f"profile/home mismatch: {profile_id!r} requires {expected}, got {home}"
            )
        suffix = "" if profile_id == "default" else f"-{profile_id}"
        return cls(profile_id, home, f"ai.hermes.gateway{suffix}")


def service_argv(identity: ProfileIdentity, python: str = "python3") -> tuple[str, ...]:
    """Return identity-bound argv with same-profile-only replacement authority."""

    return (
        python,
        "-m",
        "hermes_cli.main",
        "--profile",
        identity.profile_id,
        "gateway",
        "run",
        "--replace-same-profile",
    )


@dataclass(frozen=True)
class ServiceSpec:
    service_id: str
    hermes_home: str
    argv: tuple[str, ...]


def migrate_service(
    spec: ServiceSpec, identity: ProfileIdentity, python: str = "python3"
) -> ServiceSpec:
    if spec.service_id != identity.service_id:
        raise LifecycleError("service label does not match the target profile")
    if _canonical(spec.hermes_home) != identity.hermes_home:
        raise LifecycleError("service HERMES_HOME does not match the target profile")
    explicit_profiles = [
        spec.argv[index + 1]
        for index, value in enumerate(spec.argv[:-1])
        if value in {"-p", "--profile"}
    ]
    if explicit_profiles and explicit_profiles != [identity.profile_id]:
        raise LifecycleError("service argv identifies a different profile")
    return ServiceSpec(
        identity.service_id, identity.hermes_home, service_argv(identity, python)
    )


@dataclass(frozen=True)
class ObservedGateway:
    profile_id: str
    hermes_home: str
    service_id: str
    pid: int
    start_time: int
    generation: str
    ready: bool
    bound_ports: tuple[int, ...] = ()


def assert_observed_identity(
    identity: ProfileIdentity, observed: ObservedGateway
) -> None:
    if (
        observed.profile_id != identity.profile_id
        or _canonical(observed.hermes_home) != identity.hermes_home
        or observed.service_id != identity.service_id
    ):
        raise LifecycleError("observed gateway identity drifted from the target")


def may_replace(replacer: ProfileIdentity, target: ObservedGateway) -> bool:
    return (
        replacer.profile_id == target.profile_id
        and replacer.hermes_home == _canonical(target.hermes_home)
        and replacer.service_id == target.service_id
    )


@dataclass(frozen=True)
class PortBinding:
    profile_id: str
    platform: str
    host: str
    port: int
    explicit: bool


def _hosts_overlap(left: str, right: str) -> bool:
    wildcards = {"", "0.0.0.0", "::", "*"}
    if left in wildcards or right in wildcards:
        return True
    return left == right


def validate_topology(
    bindings: Iterable[PortBinding], *, multiplex: bool = False
) -> tuple[PortBinding, ...]:
    bindings = tuple(bindings)
    for binding in bindings:
        if binding.profile_id != "default" and not binding.explicit:
            raise LifecycleError(
                f"{binding.profile_id}/{binding.platform} needs an explicit port"
            )
        if multiplex and binding.profile_id != "default":
            raise LifecycleError(
                "secondary profiles cannot own listeners in multiplex mode"
            )
        if not 1 <= binding.port <= 65535:
            raise LifecycleError(f"invalid port: {binding.port}")
    for index, left in enumerate(bindings):
        for right in bindings[index + 1 :]:
            if left.port == right.port and _hosts_overlap(left.host, right.host):
                raise LifecycleError(
                    "port collision: "
                    f"{left.profile_id}/{left.platform} and "
                    f"{right.profile_id}/{right.platform} both claim "
                    f"{left.host or '*'}:{left.port}"
                )
    return bindings


def port_lease_key(binding: PortBinding) -> str:
    host = "*" if binding.host in {"", "0.0.0.0", "::", "*"} else binding.host
    return f"tcp-listener:{host}:{binding.port}"


@dataclass(frozen=True)
class DispatcherBoard:
    board_id: str
    owner_profile: str = "default"

    def lock_key_for(self, claimant_profile: str) -> str:
        if claimant_profile != self.owner_profile:
            raise LifecycleError(
                f"board {self.board_id} is owned by {self.owner_profile}"
            )
        return f"kanban-dispatcher:{self.board_id}"


@dataclass(frozen=True)
class RestartPlan:
    identity: ProfileIdentity
    prior_pid: int
    prior_start_time: int
    prior_generation: str
    expected_generation: str
    expected_ports: tuple[int, ...]
    fingerprint: str


def prepare_restart(
    identity: ProfileIdentity,
    observed: ObservedGateway,
    *,
    expected_generation: str,
    expected_ports: Iterable[int] = (),
) -> RestartPlan:
    assert_observed_identity(identity, observed)
    if not may_replace(identity, observed):
        raise LifecycleError("replacement target is not the same profile identity")
    ports = tuple(sorted(expected_ports))
    material = "|".join(
        (
            identity.profile_id,
            identity.hermes_home,
            identity.service_id,
            str(observed.pid),
            str(observed.start_time),
            observed.generation,
            expected_generation,
            ",".join(map(str, ports)),
        )
    )
    return RestartPlan(
        identity,
        observed.pid,
        observed.start_time,
        observed.generation,
        expected_generation,
        ports,
        sha256(material.encode()).hexdigest()[:16],
    )


def verify_restart(plan: RestartPlan, after: ObservedGateway) -> None:
    assert_observed_identity(plan.identity, after)
    if after.pid == plan.prior_pid and after.start_time == plan.prior_start_time:
        raise LifecycleError("restart did not replace the prior process")
    if after.generation != plan.expected_generation:
        raise LifecycleError("running generation does not match the prepared restart")
    if not after.ready:
        raise LifecycleError("replacement gateway is not ready")
    missing = set(plan.expected_ports) - set(after.bound_ports)
    if missing:
        raise LifecycleError(f"replacement gateway did not bind ports: {sorted(missing)}")
