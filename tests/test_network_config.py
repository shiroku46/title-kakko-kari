"""Regression tests for Render outbound-network configuration (Issue #20)."""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class TestDnsStartupOrdering(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read("server/src/index.js")

    def test_uses_node_dns(self):
        self.assertIn("require('node:dns')", self.source)

    def test_prefers_ipv4(self):
        self.assertIn("setDefaultResultOrder('ipv4first')", self.source)

    def test_dns_configuration_precedes_socket_import(self):
        dns_position = self.source.index("setDefaultResultOrder('ipv4first')")
        socket_position = self.source.index("require('./socket')")
        self.assertLess(
            dns_position,
            socket_position,
            "DNS ordering must be configured before Socket handlers perform outbound requests",
        )

    def test_dns_configuration_precedes_any_fetch(self):
        dns_position = self.source.index("setDefaultResultOrder('ipv4first')")
        fetch_position = self.source.index("fetch(")
        self.assertLess(dns_position, fetch_position)

    def test_cors_and_socket_origin_policy_preserved(self):
        self.assertIn("app.use(cors({ origin: corsOrigin }))", self.source)
        self.assertIn("allowRequest:", self.source)
        self.assertIn("isAllowedOrigin(req.headers.origin)", self.source)


class TestNodeRuntimeDeclaration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package = json.loads(read("server/package.json"))

    def test_node_engine_is_declared(self):
        self.assertIn("engines", self.package)
        self.assertIn("node", self.package["engines"])

    def test_node_engine_requires_global_fetch_runtime(self):
        engine = self.package["engines"]["node"]
        self.assertIn(">=20", engine)

    def test_node_engine_avoids_unbounded_future_major(self):
        engine = self.package["engines"]["node"]
        self.assertIn("<25", engine)


if __name__ == "__main__":
    unittest.main()
