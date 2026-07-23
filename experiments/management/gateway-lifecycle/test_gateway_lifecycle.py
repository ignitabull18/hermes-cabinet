import tempfile
import unittest
from pathlib import Path

from gateway_lifecycle import (
    DispatcherBoard,
    LifecycleError,
    ObservedGateway,
    PortBinding,
    ProfileIdentity,
    ServiceSpec,
    may_replace,
    migrate_service,
    port_lease_key,
    prepare_restart,
    service_argv,
    validate_topology,
    verify_restart,
)


class GatewayLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = str(Path(self.temp.name) / ".hermes")
        self.default = ProfileIdentity.resolve("default", self.root, self.root)
        self.operator = ProfileIdentity.resolve(
            "operator-os", f"{self.root}/profiles/operator-os", self.root
        )

    def tearDown(self):
        self.temp.cleanup()

    def observed(self, identity=None, **overrides):
        identity = identity or self.default
        values = {
            "profile_id": identity.profile_id,
            "hermes_home": identity.hermes_home,
            "service_id": identity.service_id,
            "pid": 101,
            "start_time": 1000,
            "generation": "old",
            "ready": True,
            "bound_ports": (8642,),
        }
        values.update(overrides)
        return ObservedGateway(**values)

    def test_default_service_argv_is_explicit(self):
        argv = service_argv(self.default)
        self.assertEqual(argv[3:5], ("--profile", "default"))
        self.assertIn("--replace-same-profile", argv)
        self.assertNotIn("--replace", argv)

    def test_named_service_argv_is_explicit(self):
        self.assertEqual(service_argv(self.operator)[4], "operator-os")

    def test_profile_home_mismatch_is_blocked(self):
        with self.assertRaisesRegex(LifecycleError, "profile/home mismatch"):
            ProfileIdentity.resolve("default", self.operator.hermes_home, self.root)

    def test_legacy_default_service_migrates_to_explicit_identity(self):
        legacy = ServiceSpec(
            "ai.hermes.gateway",
            self.default.hermes_home,
            ("python3", "-m", "hermes_cli.main", "gateway", "run", "--replace"),
        )
        migrated = migrate_service(legacy, self.default)
        self.assertEqual(migrated.argv, service_argv(self.default))

    def test_migration_blocks_observed_identity_drift(self):
        drifted = ServiceSpec(
            "ai.hermes.gateway",
            self.operator.hermes_home,
            ("python3", "-m", "hermes_cli.main", "gateway", "run"),
        )
        with self.assertRaisesRegex(LifecycleError, "HERMES_HOME"):
            migrate_service(drifted, self.default)

    def test_replace_is_same_profile_only(self):
        self.assertTrue(may_replace(self.default, self.observed()))
        self.assertFalse(may_replace(self.operator, self.observed()))

    def test_named_independent_listener_requires_explicit_port(self):
        with self.assertRaisesRegex(LifecycleError, "explicit port"):
            validate_topology(
                [PortBinding("operator-os", "api_server", "127.0.0.1", 8642, False)]
            )

    def test_wildcard_port_collision_is_blocked(self):
        with self.assertRaisesRegex(LifecycleError, "port collision"):
            validate_topology(
                [
                    PortBinding("default", "api_server", "0.0.0.0", 8642, False),
                    PortBinding("operator-os", "api_server", "127.0.0.1", 8642, True),
                ]
            )

    def test_distinct_profile_ports_pass_and_produce_lease_keys(self):
        bindings = validate_topology(
            [
                PortBinding("default", "api_server", "127.0.0.1", 8642, False),
                PortBinding("operator-os", "api_server", "127.0.0.1", 8742, True),
            ]
        )
        self.assertEqual(port_lease_key(bindings[1]), "tcp-listener:127.0.0.1:8742")

    def test_multiplex_secondary_listener_is_blocked(self):
        with self.assertRaisesRegex(LifecycleError, "multiplex"):
            validate_topology(
                [PortBinding("operator-os", "api_server", "127.0.0.1", 8742, True)],
                multiplex=True,
            )

    def test_dispatcher_owner_is_explicit_and_lock_is_per_board(self):
        board = DispatcherBoard("support", "operator-os")
        self.assertEqual(
            board.lock_key_for("operator-os"), "kanban-dispatcher:support"
        )
        with self.assertRaisesRegex(LifecycleError, "owned by operator-os"):
            board.lock_key_for("default")

    def test_restart_requires_exact_identity_and_new_ready_generation(self):
        plan = prepare_restart(
            self.default,
            self.observed(),
            expected_generation="new",
            expected_ports=(8642, 8644),
        )
        self.assertEqual(len(plan.fingerprint), 16)
        verify_restart(
            plan,
            self.observed(
                pid=202,
                start_time=2000,
                generation="new",
                bound_ports=(8642, 8644),
            ),
        )
        with self.assertRaisesRegex(LifecycleError, "not ready"):
            verify_restart(
                plan,
                self.observed(
                    pid=202, start_time=2000, generation="new", ready=False
                ),
            )


if __name__ == "__main__":
    unittest.main()
