"""Static safety tests for Render network diagnostics (Issue #24)."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class TestSafeNetworkDiagnostics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read("server/src/index.js")

    def test_health_preserves_status_ok(self):
        self.assertIn("status: 'ok'", self.source)
        self.assertIn("app.get('/health'", self.source)

    def test_release_uses_render_commit_and_is_truncated(self):
        self.assertIn("process.env.RENDER_GIT_COMMIT", self.source)
        self.assertIn(".slice(0, 12)", self.source)

    def test_runtime_info_includes_node_and_dns_order(self):
        self.assertIn("node: process.version", self.source)
        self.assertIn("dnsOrder: dns.getDefaultResultOrder()", self.source)

    def test_network_diagnostic_route_exists(self):
        self.assertIn("app.get('/health/network'", self.source)

    def test_network_request_is_bounded(self):
        self.assertIn("new AbortController()", self.source)
        self.assertIn("setTimeout(() => controller.abort(), 8000)", self.source)
        self.assertIn("signal: controller.signal", self.source)
        self.assertIn("clearTimeout(timeout)", self.source)

    def test_failure_response_is_sanitized(self):
        self.assertIn("errorName", self.source)
        self.assertIn("errorCode", self.source)
        self.assertIn("error?.cause?.code", self.source)
        self.assertNotIn("stack:", self.source)
        self.assertNotIn("message: error", self.source)
        self.assertNotIn("headers:", self._network_route_block())

    def test_diagnostics_do_not_return_sensitive_environment_values(self):
        route = self._network_route_block()
        for sensitive in (
            "SUPABASE_URL",
            "SUPABASE_SERVICE_ROLE_KEY",
            "PASSWORD",
            "TOKEN",
            "SECRET",
        ):
            self.assertNotIn(sensitive, route)

    def test_existing_cors_and_socket_guards_are_preserved(self):
        self.assertIn("app.use(cors({ origin: corsOrigin }))", self.source)
        self.assertIn("allowRequest:", self.source)
        self.assertIn("isAllowedOrigin(req.headers.origin)", self.source)

    def _network_route_block(self):
        start = self.source.index("app.get('/health/network'")
        end = self.source.index("// Wikipedia ランダム記事取得", start)
        return self.source[start:end]


if __name__ == "__main__":
    unittest.main()
