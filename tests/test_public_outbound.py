"""Temporary public outbound-network diagnostic for Issue #18."""

import json
import unittest
import urllib.request


ORIGIN = "https://title-kakko-kari-46mastei-4511s-projects.vercel.app"
URL = "https://title-kakko-kari.onrender.com/api/random-work"


class TestRenderOutboundFetch(unittest.TestCase):
    def test_wikipedia_proxy_can_fetch(self):
        request = urllib.request.Request(
            URL,
            headers={
                "Origin": ORIGIN,
                "Accept": "application/json",
                "User-Agent": "title-kakko-kari-public-e2e/1.0",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            self.assertEqual(response.status, 200)
            cors = response.headers.get("Access-Control-Allow-Origin")
            self.assertIn(cors, ("*", ORIGIN))
            payload = json.loads(response.read().decode("utf-8"))
        print("PUBLIC_OUTBOUND_RESULT", json.dumps(payload, ensure_ascii=False))
        self.assertTrue(payload.get("ok"), payload)
        self.assertTrue(payload.get("title"))
        self.assertTrue(payload.get("synopsis"))


if __name__ == "__main__":
    unittest.main()
