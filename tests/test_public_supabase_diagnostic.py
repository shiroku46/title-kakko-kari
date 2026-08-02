"""Temporary deployed Supabase diagnostic for Issue #18; never merge."""

import json
import unittest
import urllib.error
import urllib.request


SERVER = "https://title-kakko-kari.onrender.com"
ORIGIN = "https://title-kakko-kari-46mastei-4511s-projects.vercel.app"
EXPECTED_RELEASE = "fa8a81efc929"


def request_json(path):
    request = urllib.request.Request(
        f"{SERVER}{path}",
        headers={
            "Origin": ORIGIN,
            "Accept": "application/json",
            "User-Agent": "title-kakko-kari-supabase-diagnostic/1.0",
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return error.code, error.headers, json.loads(body)
    with response:
        return response.status, response.headers, json.loads(response.read().decode("utf-8"))


class TestDeployedSupabaseDiagnostic(unittest.TestCase):
    def test_release_and_supabase_evidence(self):
        health_status, health_headers, health = request_json("/health")
        diag_status, diag_headers, diag = request_json("/health/supabase")

        print("DEPLOYED_HEALTH", json.dumps(health, sort_keys=True))
        print("SUPABASE_DIAGNOSTIC", json.dumps(diag, sort_keys=True))

        self.assertEqual(health_status, 200)
        self.assertIn(health_headers.get("Access-Control-Allow-Origin"), ("*", ORIGIN))
        self.assertEqual(health.get("release"), EXPECTED_RELEASE)
        self.assertEqual(diag.get("release"), EXPECTED_RELEASE)
        self.assertIn(diag_headers.get("Access-Control-Allow-Origin"), ("*", ORIGIN))
        self.assertIn(diag_status, (200, 502, 503))

        config = diag.get("config", {})
        dns = diag.get("dns", {})
        request = diag.get("request", {})
        self.assertIsInstance(config.get("urlConfigured"), bool)
        self.assertIsInstance(config.get("keyConfigured"), bool)
        self.assertIsInstance(config.get("urlValidHttps"), bool)
        self.assertIn("ok", dns)
        self.assertIn("ok", request)

        if diag_status != 200:
            self.fail(
                "Supabase production diagnostic is not healthy: "
                f"{json.dumps({'config': config, 'dns': dns, 'request': request}, sort_keys=True)}"
            )


if __name__ == "__main__":
    unittest.main()
