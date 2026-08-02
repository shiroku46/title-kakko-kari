"""Static safety tests for Supabase connection diagnostics (Issue #28)."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def read(path):
    return (ROOT / path).read_text(encoding="utf-8")


class TestSupabaseDiagnostics(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = read("server/src/index.js")
        start = cls.source.index("app.get('/health/supabase'")
        end = cls.source.index("// Wikipedia ランダム記事取得", start)
        cls.route = cls.source[start:end]

    def test_route_exists(self):
        self.assertIn("app.get('/health/supabase'", self.source)

    def test_reports_boolean_configuration_state(self):
        self.assertIn("urlConfigured", self.route)
        self.assertIn("keyConfigured", self.route)
        self.assertIn("urlValidHttps", self.route)

    def test_https_url_validation(self):
        self.assertIn("parsedUrl.protocol === 'https:'", self.route)
        self.assertIn("Boolean(parsedUrl.hostname)", self.route)

    def test_ipv4_dns_lookup_is_bounded(self):
        self.assertIn("dns.promises.lookup(hostname, { family: 4 })", self.source)
        self.assertIn("Promise.race", self.source)
        self.assertIn("ETIMEDOUT", self.source)
        self.assertIn("lookupIpv4Bounded(parsedUrl.hostname, 5000)", self.route)

    def test_request_is_bounded_and_body_disposed(self):
        self.assertIn("new AbortController()", self.route)
        self.assertIn("setTimeout(() => controller.abort(), 8000)", self.route)
        self.assertIn("signal: controller.signal", self.route)
        self.assertIn("response.body.cancel()", self.route)
        self.assertLess(self.route.index("response.body.cancel()"), self.route.index("clearTimeout(timeout)"))

    def test_authenticated_read_only_request(self):
        self.assertIn("/rest/v1/rooms?select=id&limit=1", self.route)
        self.assertIn("method: 'GET'", self.route)
        self.assertIn("apikey: serviceKey", self.route)
        self.assertIn("Authorization: `Bearer ${serviceKey}`", self.route)

    def test_response_is_sanitized(self):
        self.assertIn("httpStatus", self.route)
        self.assertIn("errorName", self.route)
        self.assertIn("errorCode", self.route)
        for forbidden in (
            "rawUrl,",
            "serviceKey,",
            "hostname:",
            "error.message",
            "error.stack",
            "stack:",
            "headers:",
            "response.text",
            "response.json",
        ):
            self.assertNotIn(forbidden, self.route)

    def test_runtime_fields_reused(self):
        self.assertIn("...runtimeInfo()", self.route)

    def test_existing_health_network_and_socket_guards_preserved(self):
        self.assertIn("app.get('/health'", self.source)
        self.assertIn("app.get('/health/network'", self.source)
        self.assertIn("app.use(cors({ origin: corsOrigin }))", self.source)
        self.assertIn("allowRequest:", self.source)


if __name__ == "__main__":
    unittest.main()
