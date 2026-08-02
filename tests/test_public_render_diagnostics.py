"""Temporary deployed Render diagnostics for Issue #18; never merge."""

import json
import unittest
import urllib.error
import urllib.request


SERVER = "https://title-kakko-kari.onrender.com"
ORIGIN = "https://title-kakko-kari-46mastei-4511s-projects.vercel.app"
EXPECTED_RELEASE = "246d40c3a9f4"


def request_json(path):
    request = urllib.request.Request(
        f"{SERVER}{path}",
        headers={
            "Origin": ORIGIN,
            "Accept": "application/json",
            "User-Agent": "title-kakko-kari-render-diagnostic/1.0",
        },
    )
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        return error.code, error.headers, json.loads(body)
    with response:
        body = response.read().decode("utf-8")
        return response.status, response.headers, json.loads(body)


class TestDeployedRenderDiagnostics(unittest.TestCase):
    def test_release_and_network_transport(self):
        health_status, health_headers, health = request_json("/health")
        network_status, network_headers, network = request_json("/health/network")

        print("DEPLOYED_HEALTH", json.dumps(health, sort_keys=True))
        print("DEPLOYED_NETWORK", json.dumps(network, sort_keys=True))

        self.assertEqual(health_status, 200)
        self.assertIn(health_headers.get("Access-Control-Allow-Origin"), ("*", ORIGIN))
        self.assertEqual(health.get("status"), "ok")
        self.assertEqual(
            health.get("release"),
            EXPECTED_RELEASE,
            "Render has not deployed the diagnostic main commit",
        )
        self.assertTrue(str(health.get("node", "")).startswith("v"))
        self.assertEqual(health.get("dnsOrder"), "ipv4first")

        self.assertIn(network_headers.get("Access-Control-Allow-Origin"), ("*", ORIGIN))
        self.assertEqual(network.get("release"), EXPECTED_RELEASE)
        self.assertEqual(network.get("dnsOrder"), "ipv4first")
        self.assertIn(network_status, (200, 502, 503))
        outbound = network.get("outbound", {})
        self.assertIn("ok", outbound)

        # HTTP responses, including rate limits, prove DNS/TLS/outbound transport
        # succeeded. Only a sanitized fetch exception (503) is a transport failure.
        self.assertNotEqual(
            network_status,
            503,
            f"Render outbound transport failed: {json.dumps(outbound, sort_keys=True)}",
        )
        if network_status == 502:
            self.assertIsInstance(outbound.get("httpStatus"), int)


if __name__ == "__main__":
    unittest.main()
