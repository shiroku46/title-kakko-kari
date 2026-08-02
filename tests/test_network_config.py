"""Verify DNS ordering and Node runtime declaration for outbound fetch reliability."""
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding="utf-8")


class TestDnsIpv4First(unittest.TestCase):
    def setUp(self):
        self.server_index = read("server/src/index.js")
        self.lines = self.server_index.splitlines()

    def test_dns_module_required(self):
        self.assertIn("require('node:dns')", self.server_index,
                      "node:dns must be imported in server/src/index.js")

    def test_ipv4first_ordering_set(self):
        self.assertIn("setDefaultResultOrder('ipv4first')", self.server_index,
                      "DNS must be configured to prefer IPv4 via setDefaultResultOrder")

    def _line_index(self, substring: str) -> int:
        for i, line in enumerate(self.lines):
            if substring in line:
                return i
        return -1

    def test_dns_before_dotenv(self):
        dns_line = self._line_index("require('node:dns')")
        dotenv_line = self._line_index("require('dotenv')")
        self.assertGreaterEqual(dns_line, 0, "node:dns require line not found")
        self.assertGreaterEqual(dotenv_line, 0, "dotenv require line not found")
        self.assertLess(dns_line, dotenv_line,
                        "node:dns must be imported before dotenv to run before any other setup")

    def test_dns_before_express(self):
        dns_line = self._line_index("require('node:dns')")
        express_line = self._line_index("require('express')")
        self.assertGreaterEqual(dns_line, 0, "node:dns require line not found")
        self.assertGreaterEqual(express_line, 0, "express require line not found")
        self.assertLess(dns_line, express_line,
                        "node:dns must be imported before express")

    def test_dns_before_socket_io(self):
        dns_line = self._line_index("require('node:dns')")
        socket_line = self._line_index("require('socket.io')")
        self.assertGreaterEqual(dns_line, 0, "node:dns require line not found")
        self.assertGreaterEqual(socket_line, 0, "socket.io require line not found")
        self.assertLess(dns_line, socket_line,
                        "node:dns must be imported before socket.io")

    def test_set_default_result_order_before_dotenv(self):
        set_order_line = self._line_index("setDefaultResultOrder")
        dotenv_line = self._line_index("require('dotenv')")
        self.assertGreaterEqual(set_order_line, 0, "setDefaultResultOrder call not found")
        self.assertGreaterEqual(dotenv_line, 0, "dotenv require line not found")
        self.assertLess(set_order_line, dotenv_line,
                        "setDefaultResultOrder must execute before dotenv config")


class TestNodeEngineDeclaration(unittest.TestCase):
    def setUp(self):
        self.pkg = json.loads(read("server/package.json"))

    def test_engines_field_present(self):
        self.assertIn("engines", self.pkg,
                      "server/package.json must declare an engines field")

    def test_engines_node_field_present(self):
        self.assertIn("node", self.pkg.get("engines", {}),
                      "engines field must include a node key")

    def test_node_engine_requires_18_or_higher(self):
        node_range = self.pkg.get("engines", {}).get("node", "")
        self.assertIn("18", node_range,
                      "Node engine declaration must require >=18 (needed for global fetch and node:dns)")

    def test_node_engine_uses_gte_operator(self):
        node_range = self.pkg.get("engines", {}).get("node", "")
        self.assertIn(">=", node_range,
                      "Node engine range must use >= to allow current LTS versions")


if __name__ == "__main__":
    unittest.main()
