"""Temporary production E2E verification for Issues #18 and #25.

This file is intentionally added only to an unmerged verification PR. It uses
Python's standard library to verify the deployed Vercel client and Render
server without credentials or extra dependencies.
"""
from __future__ import annotations

import json
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request

PUBLIC_ORIGIN = "https://title-kakko-kari-46mastei-4511s-projects.vercel.app"
SERVER = "https://title-kakko-kari.onrender.com"
EXPECTED_RELEASE = "c65563aed5bd"
TIMEOUT = 45
DEPLOY_WAIT_SECONDS = 240


def _request(url, *, method="GET", data=None, origin=None):
    headers = {
        "User-Agent": "title-kakko-kari-public-e2e/2.0",
        "Accept": "*/*",
    }
    if origin:
        headers["Origin"] = origin
    encoded = None
    if data is not None:
        encoded = data.encode("utf-8")
        headers["Content-Type"] = "text/plain;charset=UTF-8"
    request = urllib.request.Request(
        url,
        data=encoded,
        headers=headers,
        method=method,
    )
    return urllib.request.urlopen(request, timeout=TIMEOUT)


def _json_get(path, *, origin=None):
    try:
        response = _request(f"{SERVER}{path}", origin=origin)
    except urllib.error.HTTPError as error:
        with error:
            return error.code, error.headers, json.loads(error.read().decode("utf-8"))
    with response:
        return response.status, response.headers, json.loads(response.read().decode("utf-8"))


def _wait_for_exact_render_release():
    deadline = time.monotonic() + DEPLOY_WAIT_SECONDS
    last = None
    while time.monotonic() < deadline:
        try:
            status, _, payload = _json_get("/health", origin=PUBLIC_ORIGIN)
            last = {"httpStatus": status, "release": payload.get("release")}
            if status == 200 and payload.get("release") == EXPECTED_RELEASE:
                return payload
        except Exception as error:  # network wake-up/redeploy can transiently fail
            last = {"errorName": type(error).__name__}
        time.sleep(10)
    raise AssertionError(
        "Render did not expose the expected merged release within the bounded wait: "
        + json.dumps(last, sort_keys=True)
    )


class SocketIOPollingClient:
    """Minimal default-namespace Socket.IO client over Engine.IO polling."""

    def __init__(self, origin):
        self.origin = origin
        self.sid = None
        self.ack_id = 0
        self.handshake_cors = None

    def _url(self):
        query = {
            "EIO": "4",
            "transport": "polling",
            "t": str(time.time_ns()),
        }
        if self.sid:
            query["sid"] = self.sid
        return f"{SERVER}/socket.io/?{urllib.parse.urlencode(query)}"

    def _get(self):
        with _request(self._url(), origin=self.origin) as response:
            self.handshake_cors = self.handshake_cors or response.headers.get(
                "Access-Control-Allow-Origin"
            )
            return response.read().decode("utf-8")

    def _post(self, packet):
        with _request(
            self._url(), method="POST", data=packet, origin=self.origin
        ) as response:
            cors = response.headers.get("Access-Control-Allow-Origin")
            if cors:
                self.handshake_cors = self.handshake_cors or cors
            response.read()

    @staticmethod
    def _packets(payload):
        return [packet for packet in payload.split("\x1e") if packet]

    @staticmethod
    def assert_protocol(condition, message):
        if not condition:
            raise AssertionError(message)

    def connect(self):
        payload = self._get()
        open_packets = [p for p in self._packets(payload) if p.startswith("0")]
        self.assert_protocol(open_packets, f"missing Engine.IO open packet: {payload!r}")
        opened = json.loads(open_packets[0][1:])
        self.sid = opened["sid"]
        self.assert_protocol(bool(self.sid), "Engine.IO returned an empty sid")
        self.assert_protocol(
            self.handshake_cors in ("*", self.origin),
            f"Socket handshake CORS denied origin: {self.handshake_cors!r}",
        )

        self._post("40")
        deadline = time.monotonic() + TIMEOUT
        while time.monotonic() < deadline:
            for packet in self._packets(self._get()):
                if packet == "2":
                    self._post("3")
                elif packet.startswith("40"):
                    return
                elif packet.startswith("44"):
                    raise AssertionError(f"Socket.IO namespace error: {packet}")
        raise AssertionError("Socket.IO default namespace did not connect")

    def emit_ack(self, event, payload):
        self.ack_id += 1
        ack_id = self.ack_id
        body = json.dumps([event, payload], ensure_ascii=False, separators=(",", ":"))
        self._post(f"42{ack_id}{body}")

        expected = f"43{ack_id}"
        deadline = time.monotonic() + TIMEOUT
        observed = []
        while time.monotonic() < deadline:
            for packet in self._packets(self._get()):
                observed.append(packet[:120])
                if packet == "2":
                    self._post("3")
                    continue
                if packet.startswith(expected):
                    values = json.loads(packet[len(expected):])
                    self.assert_protocol(
                        isinstance(values, list) and values,
                        f"invalid ACK payload for {event}: {values!r}",
                    )
                    return values[0]
                if packet.startswith("44"):
                    raise AssertionError(f"Socket.IO error while waiting for {event}: {packet}")
        raise AssertionError(
            f"timed out waiting for ACK to {event}; observed={observed[-10:]}"
        )

    def disconnect(self):
        if not self.sid:
            return
        try:
            self._post("41")
            self._post("1")
        except Exception:
            pass
        self.sid = None


class TestPublicProductionE2E(unittest.TestCase):
    clients = []

    @classmethod
    def tearDownClass(cls):
        for client in reversed(cls.clients):
            client.disconnect()

    def test_public_room_create_join_and_start(self):
        # Never verify against a stale Render release.
        health = _wait_for_exact_render_release()
        self.assertEqual(health.get("status"), "ok")
        self.assertEqual(health.get("release"), EXPECTED_RELEASE)

        with _request(f"{PUBLIC_ORIGIN}/") as response:
            self.assertEqual(response.status, 200)
            self.assertIn("text/html", response.headers.get("Content-Type", ""))
            self.assertIn("<html", response.read().decode("utf-8", errors="replace").lower())

        status, headers, supabase_health = _json_get(
            "/health/supabase", origin=PUBLIC_ORIGIN
        )
        safe_evidence = {
            "httpStatus": status,
            "release": supabase_health.get("release"),
            "config": supabase_health.get("config"),
            "dns": supabase_health.get("dns"),
            "request": supabase_health.get("request"),
        }
        print("PUBLIC_SUPABASE_HEALTH", json.dumps(safe_evidence, sort_keys=True))
        self.assertIn(headers.get("Access-Control-Allow-Origin"), ("*", PUBLIC_ORIGIN))
        self.assertEqual(status, 200, safe_evidence)
        self.assertEqual(supabase_health.get("release"), EXPECTED_RELEASE)
        self.assertEqual(
            supabase_health.get("config"),
            {"urlConfigured": True, "keyConfigured": True, "urlValidHttps": True},
            safe_evidence,
        )
        self.assertEqual(supabase_health.get("dns"), {"ok": True, "family": 4, "errorCode": None}, safe_evidence)
        self.assertTrue(supabase_health.get("request", {}).get("ok"), safe_evidence)

        unique = str(int(time.time()))[-6:]
        host = SocketIOPollingClient(PUBLIC_ORIGIN)
        self.clients.append(host)
        host.connect()
        created = host.emit_ack("room:create", {"nickname": f"H{unique}"})
        self.assertTrue(created.get("ok"), created)
        code = created.get("room", {}).get("code", "")
        self.assertRegex(code, r"^[A-Z0-9]{6}$")
        self.assertTrue(created.get("player", {}).get("is_host"), created)

        for number in range(1, 4):
            client = SocketIOPollingClient(PUBLIC_ORIGIN)
            self.clients.append(client)
            client.connect()
            joined = client.emit_ack(
                "room:join",
                {"code": code, "nickname": f"P{number}{unique}"},
            )
            self.assertTrue(joined.get("ok"), joined)
            self.assertEqual(joined.get("room", {}).get("code"), code)
            self.assertEqual(len(joined.get("allPlayers", [])), number + 1)

        started = host.emit_ack("game:start", {"mode": "cpu", "totalRounds": 3})
        self.assertTrue(started.get("ok"), started)

        print(
            "PUBLIC_E2E_OK",
            json.dumps(
                {
                    "renderRelease": EXPECTED_RELEASE,
                    "vercel": 200,
                    "supabaseHealth": True,
                    "socketHandshake": True,
                    "roomCreate": True,
                    "roomCodeLength": len(code),
                    "roomJoinCount": 4,
                    "gameStart": True,
                },
                sort_keys=True,
            ),
        )


if __name__ == "__main__":
    unittest.main()
